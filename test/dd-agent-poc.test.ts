import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { DdAgentStack } from '../lib/dd-agent-stack';

test('Resources Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new DdAgentStack(app, 'MyTestStack', {
    envName: 'dev',
  });
  // THEN
  const template = Template.fromStack(stack);

  // Check VPC is created
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.0.0.0/16',
  });

  // Check ECS Cluster is created
  template.hasResourceProperties('AWS::ECS::Cluster', {
    ClusterName: 'dd-agent-cluster-dev',
  });

  // Check ECS Service is created
  template.hasResourceProperties('AWS::ECS::Service', {
    ServiceName: 'dd-agent-service-dev',
    DesiredCount: 1,
  });

  // Check Application Load Balancer is created
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    Name: 'dd-agent-alb-dev',
    Scheme: 'internet-facing',
  });

  // Check Security Groups are created
  template.resourceCountIs('AWS::EC2::SecurityGroup', 2);
});
