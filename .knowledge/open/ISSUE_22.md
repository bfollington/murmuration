---
id: ISSUE_22
type: issue
status: open
timestamp: '2025-08-04T10:28:46.666Z'
lastUpdated: '2025-08-04T10:28:46.666Z'
tags:
  - enhancement
  - ci
  - github-actions
  - release
  - build
title: Add GitHub Action for automated binary releases
priority: high
---

# Add GitHub Action for automated binary releases

## Current State
- No automated release process exists
- Manual builds required for each platform
- No binary artifacts published to GitHub releases

## Requirements
- Build binaries for multiple platforms (Linux x64, macOS x64/arm64, Windows x64)
- Trigger on version tags (e.g., v1.0.0)
- Create GitHub release with built artifacts
- Include release notes from CHANGELOG or commit messages

## Known subtasks
- [ ] Create `.github/workflows/release.yml`
- [ ] Configure Deno compile for cross-platform builds
- [ ] Set up matrix build for target platforms
- [ ] Configure artifact upload and release creation
- [ ] Add build scripts to package.json/deno.json
- [ ] Test release workflow with a pre-release tag
- [ ] Document release process in README

## Technical Details
- Use `deno compile` to create self-contained binaries
- Binary naming convention: `murmuration-{platform}-{arch}`
- Compress binaries before upload (tar.gz for Unix, zip for Windows)
- Include version info in binary metadata

## Platforms to Support
- Ubuntu/Linux x86_64
- macOS x86_64 (Intel)
- macOS aarch64 (Apple Silicon)
- Windows x86_64