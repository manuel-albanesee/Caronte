# Credits and third-party notices

## Caronte

Created by [Manuel Albanese (@manuel-albanesee)](https://github.com/manuel-albanesee).
The original material is distributed under the [Caronte Source-Available License v2.0](LICENSE). Commercial runtime rights for the original Caronte material are granted separately by Manuel Albanese.

## ICM and ICM Architect

- [Interpretable Context Methodology: Folder Structure as Agentic Architecture](https://arxiv.org/abs/2603.16021) by **Jake Van Clief** and **David McDermott** inspired Caronte's file-based stages and resumable handoffs.
- [ICM Architect](https://github.com/RinDig/icm-architect) by **Jake Van Clief** is bundled in `.claude/skills/icm-architect/`. The bundled copy retains [its MIT license](.claude/skills/icm-architect/LICENSE). Caronte adds a frontmatter setting for explicit invocation and implements its own stage verification in `.claude/routing/icm.cjs`.

## ECC

- [ECC](https://github.com/affaan-m/ECC) by **Affaan Mustafa** and contributors provides the upstream specialist profiles. Caronte ships selected upstream snapshots and corresponding adaptations. The original material retains [its MIT license](.claude/routing/ecc/LICENSE). The [manifest](.claude/routing/ecc/manifest.json) records the upstream revision and object hashes.
- The original Caronte instructions and workflow layered on these profiles are covered by the root license. Independent use of the original MIT materials remains governed by their upstream licenses.

## FastSkillRetrieval

- [FastSkillRetrieval](https://github.com/manuel-albanesee/FastSkillRetrieval) by **Manuel Albanese** (@manuel-albanesee), released under the MIT license, builds and queries the local BM25 index of installed skills, agents and commands. Caronte does not bundle it: the installer fetches it from the official repository at a pinned commit into `~/.fsr/venv`, and only reads its index.

## Runtime integrations

Caronte integrates with [Claude Code](https://code.claude.com/docs). Its installer can fetch [ECC](https://github.com/affaan-m/ECC), [Headroom](https://github.com/headroomlabs-ai/headroom), [RTK](https://github.com/rtk-ai/rtk), and [FastSkillRetrieval](https://github.com/manuel-albanesee/FastSkillRetrieval) from their upstream distributions. Each distribution retains its own terms. Caronte is an independent project.
