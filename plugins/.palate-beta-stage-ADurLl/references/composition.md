# Composition: how the skills compose

## website-builder invoking brand-as-code (Phase 0)
When no brand repo exists and assets are available, the BUILD SITE pipeline runs the BUILD BRAND mode in COMPOSED mode. In this mode the brand build:
- never blocks on a question; uses documented defaults
- batches all assumptions, surfaced later in handover.md
- on completion, returns the package name + exact version

## The handshake
the build records the brand repo path in state before invoking. If brand-as-code is interrupted, the build's resume detects phase brandAsCode in_progress, resumes the brand build via its own state file, then continues.

## Interactive vs composed
Standalone BUILD BRAND (Jake asks for a brand package directly) is INTERACTIVE: it asks before inventing. Only the composed path uses defaults. The skill knows which mode it is in from how it was invoked.

## Why one skill, separate modes
Brand and site have different lifecycles. A brand is built once and updated rarely; a site is built once and iterated often. Keeping them as distinct modes of one skill means a brand can feed multiple sites and a site can be rebuilt without touching the brand, while everything stays in a single installable, growable skill.
