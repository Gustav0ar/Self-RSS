name: Bug report
description: Create a report to help us improve the project
title: "[BUG] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report!
  - type: textarea
    id: describe-bug
    attributes:
      label: Describe the bug
      description: A clear and concise description of what the bug is.
      placeholder: E.g., The article sync fails when parsing atom feeds.
    validations:
      required: true
  - type: textarea
    id: reproduction-steps
    attributes:
      label: Steps to reproduce
      description: How did you encounter this bug? Include configuration details if relevant.
      placeholder: |
        1. Go to '...'
        2. Click on '....'
        3. Scroll down to '....'
        4. See error
    validations:
      required: true
  - type: textarea
    id: expected-behavior
    attributes:
      label: Expected behavior
      description: A clear and concise description of what you expected to happen.
    validations:
      required: true
  - type: dropdown
    id: environment
    attributes:
      label: Deployment Environment
      description: What system and runtime configuration are you using?
      options:
        - Docker Compose (standard)
        - Podman Compose
        - Bare metal / Bun CLI
        - Other (Kubernetes, CapRover, etc.)
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Logs or Console Output
      description: Please paste any relevant server logs or browser console errors here.
      render: shell
