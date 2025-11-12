import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  LogDrivers,
  Protocol,
  FargateService,
  ContainerInsights,
} from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ApplicationProtocol,
  ListenerAction,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { DatadogECSFargate, LoggingType } from 'datadog-cdk-constructs-v2';

export interface DdAgentStackProps extends StackProps {
  envName: string;
}

export class DdAgentStack extends Stack {
  constructor(scope: Construct, id: string, props: DdAgentStackProps) {
    super(scope, id, props);

    // 1. VPC
    const vpc = new Vpc(this, 'Vpc', {
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

    // 3. Task Definition with Datadog Agent
    const ecsDatadog = new DatadogECSFargate({
      site: "us5.datadoghq.com",
      apiKeySecret: Secret.fromSecretNameV2(this, 'DatadogApiKeySecret', 'datadog/api-key'),
      isDatadogDependencyEnabled: true,
      datadogHealthCheck: {
        command: ['CMD-SHELL', 'agent health'],
      },
      logCollection: {
        isEnabled: true,
        loggingType: LoggingType.FLUENTBIT,
        fluentbitConfig: {
          logDriverConfig: {
            hostEndpoint: 'http-intake.logs.us5.datadoghq.com'
          }
        },
      },
      globalTags: `env:${props.envName},service:dd-agent-poc,version:0.1`,
    });
    const taskDef = ecsDatadog.fargateTaskDefinition(this, 'TaskDef', {
      family: `dd-agent-poc-task-${props.envName}`,
    });

    // 4. Application (this will look different customer to customer)
    const appImage = 'public.ecr.aws/docker/library/nginx:latest';
    const appContainer = taskDef.addContainer('AppContainer', {
      image: ContainerImage.fromRegistry(appImage),
      containerName: 'app',
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
      healthCheck: { path: '/', interval: Duration.seconds(30), timeout: Duration.seconds(5), healthyThresholdCount: 2, unhealthyThresholdCount: 2 },
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

    // Outputs
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new CfnOutput(this, 'VpcId', { value: vpc.vpcId });
  }
}
