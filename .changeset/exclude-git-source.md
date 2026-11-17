---
"dagger": patch
---

Leave `.git` and `.merge-base` out of the typescript and ci module sources, so a tree checked out again reuses the layers built on it. Git commands in `/src` no longer see a repository.
