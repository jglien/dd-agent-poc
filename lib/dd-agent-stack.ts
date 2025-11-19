import path from 'path';
import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  Protocol,
  FargateService,
  ContainerInsights,
  FargateTaskDefinition,
  AwsLogDriver,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ApplicationProtocol,
  ListenerAction,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';

export interface DdAgentStackProps extends StackProps {
  envName: string;
  ddSite?: string;
  maxTaskCount?: number;
  targetRequestCountPerTask?: number;
}

export class DdAgentStack extends Stack {
  constructor(scope: Construct, id: string, props: DdAgentStackProps) {
    super(scope, id, props);

    const ddSite = props.ddSite || 'datadoghq.com';

    // 1. VPC
    const vpc = new Vpc(this, 'Vpc', {
      vpcName: `dd-agent-vpc-${props.envName}`,
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
      natGateways: 1,
    });

    // 2. ECS Cluster
    const cluster = new Cluster(this, 'ECSCluster', {
      vpc,
      containerInsightsV2: ContainerInsights.ENABLED,
      clusterName: `dd-agent-cluster-${props.envName}`,
    });

    // 3. Create Task Definition
    const taskDef = new FargateTaskDefinition(this, 'TaskDef', {
      family: `dd-agent-poc-task-${props.envName}`,
    });

    // 4. Application (this will look different customer to customer)
    const appAsset = new DockerImageAsset(this, 'AppImageAsset', {
      directory: path.join(__dirname, '..'),
    });
    const logging = new AwsLogDriver({ streamPrefix: "demo-app" });
    const appContainer = taskDef.addContainer('AppContainer', {
      image: ContainerImage.fromDockerImageAsset(appAsset),
      containerName: 'app',
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost/health || exit 1'],
        startPeriod: Duration.seconds(3),
      },
      logging,
    });
    appContainer.addPortMappings({ containerPort: 80, protocol: Protocol.TCP });

    // 5. ECS Fargate Service
    const serviceSg = new SecurityGroup(this, 'ServiceSecurityGroup', { vpc, allowAllOutbound: true, description: 'SG for Fargate service' });
    const service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      serviceName: `dd-agent-service-${props.envName}`,
    });

    const tg = new ApplicationTargetGroup(this, 'AlbTargetGroup', {
      vpc,
      protocol: ApplicationProtocol.HTTP,
      port: 80,
      targetType: TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
    });
    service.attachToApplicationTargetGroup(tg);

    // 6. Load Balancer
    const albSg = new SecurityGroup(this, 'AlbSecurityGroup', { vpc, allowAllOutbound: true, description: 'SG for ALB' });
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'Allow HTTP from internet');
    serviceSg.addIngressRule(albSg, Port.tcp(80), 'Allow ALB to app');

    const alb = new ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `dd-agent-alb-${props.envName}`,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    alb.addListener('HttpListener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.forward([tg]),
    });

    // 7. Auto Scaling Configuration
    const maxTaskCount = props.maxTaskCount ?? 10;
    const targetRequestCountPerTask = props.targetRequestCountPerTask ?? 1000;

    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: maxTaskCount,
    });

    scalableTarget.scaleOnRequestCount('AlbRequestCountScaling', {
      requestsPerTarget: targetRequestCountPerTask,
      targetGroup: tg,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Outputs
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new CfnOutput(this, 'VpcId', { value: vpc.vpcId });
  }
}
