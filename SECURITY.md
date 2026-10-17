# Security policy

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository, or by email to contact@bohr.io. Please do not open public issues for security problems.

Include the affected component, the steps to reproduce and the impact you expect. We answer within 3 business days.

## What is in scope

- The instance: control plane Worker, credential vault, GitHub App integration, platform bot.
- The project runtime deployed into users' accounts: project Worker, sandbox, staging proxy.
- The bohr.io Cloud components in `cloud/`: dispatcher and deploy API.

Instances run by third parties are operated by them. Report problems in their configuration to the operator.
