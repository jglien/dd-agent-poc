#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DdAgentStack } from '../lib/dd-agent-stack';

const envName = process.env.ENV_NAME || 'dev';

const app = new cdk.App();
new DdAgentStack(app, 'DdAgentStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  envName,
});
