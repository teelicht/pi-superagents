---
name: sp-task-loop
description: Superpowers per-task execution loop
---

## sp-implementer
reads: task-brief.md
output: implementer-report.md
progress: false

Implement the extracted task.

## sp-spec-review
reads: task-brief.md, implementer-report.md
output: spec-review.md
progress: false

Review the implementation for spec compliance.

## sp-code-review
reads: task-brief.md, spec-review.md
output: code-review.md
progress: false

Review the implementation for code quality.
