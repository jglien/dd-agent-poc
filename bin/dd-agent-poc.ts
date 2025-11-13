#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DdAgentStack } from '../lib/dd-agent-stack';

const envName = process.env.ENV_NAME || 'dev';
const ddSite = process.env.DD_SITE || 'us5.datadoghq.com';

const app = new cdk.App();
new DdAgentStack(app, `DdAgentStack2-${envName}`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  envName,
  ddSite,
});
