# Datadog Agent POC

A proof-of-concept application demonstrating Datadog observability (metrics, logs, and traces) in an AWS ECS Fargate environment using the Datadog Agent as a sidecar container.

## Overview

This project showcases a complete observability setup with:
- **Metrics**: DogStatsD metrics emitted from the application
- **Logs**: Structured JSON logs collected via Fluent Bit
- **Traces**: Distributed tracing using the Datadog APM tracer

The infrastructure is defined using AWS CDK and automatically provisions:
- VPC with public and private subnets
- ECS Fargate cluster
- Application Load Balancer (ALB)
- Datadog Agent sidecar container (via `datadog-cdk-constructs-v2`)
- Express.js API application container

## Architecture

```
Internet
   │
   ▼
Application Load Balancer (ALB)
   │
   ▼
ECS Fargate Service
   ├── App Container (Express.js API)
   │   ├── Emits structured logs to stdout
   │   ├── Sends DogStatsD metrics to localhost:8125
   │   └── Creates Datadog traces via dd-trace
   │
   └── Datadog Agent Sidecar
       ├── Collects metrics from DogStatsD
       ├── Forwards logs via Fluent Bit
       └── Collects and forwards traces
```

## Prerequisites

- Node.js 24+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)
- Datadog API key stored in AWS Secrets Manager as `datadog/api-key`
- Docker (for building container images)

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dd-agent-poc
   ```

2. **Install dependencies**
   ```bash
   npm ci
   ```

3. **Store Datadog API key in AWS Secrets Manager**
   ```bash
   aws secretsmanager create-secret \
     --name datadog/api-key \
     --secret-string "your-datadog-api-key-here" \
     --region us-east-1
   ```

4. **Bootstrap CDK (if not already done)**
   ```bash
   npx cdk bootstrap
   ```

## Deployment

### Local Development

1. **Build the project**
   ```bash
   npm run build
   ```

2. **Deploy the stack**
   ```bash
   export ENV_NAME=dev
   export DD_SITE=datadoghq.com  # or us5.datadoghq.com, etc.
   export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   export CDK_DEFAULT_REGION=us-east-1
   npx cdk deploy --all
   ```

3. **Get the ALB DNS name**
   After deployment, the CDK output will display the ALB DNS name. You can also retrieve it:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name DdAgentStack \
     --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
     --output text
   ```

4. **Test the application**
   ```bash
   curl http://<alb-dns-name>/
   ```

### CI/CD Deployment

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys on pushes to `main` or via manual workflow dispatch.

Required GitHub Secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_ACCOUNT_ID`
- `AWS_REGION` (optional, defaults to `us-east-1`)

## How It Works

### Application Container

The Express.js application (`src/server.ts`) demonstrates the three pillars of observability:

1. **Logs**: Emits structured JSON logs to stdout with correlation fields (trace_id, span_id) injected by the Datadog tracer
2. **Metrics**: Sends DogStatsD metrics (counters and histograms) to `localhost:8125`
3. **Traces**: Creates distributed traces using the `dd-trace` library

### Datadog Agent Sidecar

The `DatadogECSFargate` construct automatically:
- Adds a Datadog Agent container to the task definition
- Configures Fluent Bit for log collection
- Sets up unified service tagging (`env`, `service`, `version`)
- Configures health checks for the agent

### Environment Variables

The application uses the following environment variables (automatically set by the CDK stack):
- `DD_SERVICE`: Service name (default: `dd-agent-poc`)
- `DD_ENV`: Environment name (from stack props)
- `DD_VERSION`: Service version (default: `0.1`)
- `PORT`: Application port (default: `80`)

## Project Structure

```
.
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definitions
│   └── dd-agent-stack.ts  # Main infrastructure stack
├── src/                    # Application source code
│   └── server.ts          # Express.js API server
├── test/                   # Unit tests
├── Dockerfile             # Container image definition
├── package.json           # Dependencies and scripts
└── tsconfig.json          # TypeScript configuration
```

## Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run start` - Run the compiled server locally
- `npm test` - Run Jest unit tests
- `npm run cdk` - Run CDK commands

## CDK Commands

- `npx cdk deploy` - Deploy the stack to AWS
- `npx cdk diff` - Compare deployed stack with current state
- `npx cdk synth` - Emit the synthesized CloudFormation template
- `npx cdk destroy` - Destroy the stack

## Endpoints

- `GET /` - Main endpoint that emits log, metric, and trace
- `GET /health` - Health check endpoint for ALB target group

## Observability Features

### Metrics

The application emits the following DogStatsD metrics:
- `demo.requests`: Counter for request volume
- `demo.request_latency`: Histogram for request latency

Both metrics are tagged with: `service`, `env`, `version`, `route`, `status`

### Logs

Structured JSON logs include:
- Request metadata (method, route, status, duration)
- Unified service tags (env, service, version)
- Trace correlation IDs (automatically injected by dd-trace)

### Traces

Distributed traces are automatically created for HTTP requests and can be manually instrumented using the `dd-trace` library.

## Customization

### Changing the Datadog Site

Set the `DD_SITE` environment variable or pass it as a stack prop:
```typescript
new DdAgentStack(app, 'DdAgentStack', {
  envName: 'production',
  ddSite: 'us5.datadoghq.com',
});
```

### Modifying Infrastructure

Edit `lib/dd-agent-stack.ts` to customize:
- VPC configuration
- ECS service settings (CPU, memory, desired count)
- Load balancer settings
- Security groups

## Troubleshooting

### Agent not collecting data

1. Check the Datadog Agent container logs:
   ```bash
   aws ecs describe-tasks \
     --cluster <cluster-name> \
     --tasks <task-id> \
     --query 'tasks[0].containers[?name==`datadog-agent`]'
   ```

2. Verify the API key secret exists:
   ```bash
   aws secretsmanager get-secret-value --secret-id datadog/api-key
   ```

3. Check agent health:
   ```bash
   aws ecs execute-command \
     --cluster <cluster-name> \
     --task <task-id> \
     --container datadog-agent \
     --command "agent health" \
     --interactive
   ```

### Application not responding

1. Check ALB target group health:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <tg-arn>
   ```

2. View application container logs:
   ```bash
   aws logs tail /ecs/dd-agent-poc-task-<env> --follow
   ```
