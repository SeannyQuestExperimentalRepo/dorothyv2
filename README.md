# Trendline Dev Repo

Dorothy's workspace for Trendline development — audits, proposals, and implementation prompts.

**Main repo (read-only source):** [SeannyQuest/trendline](https://github.com/SeannyQuest/trendline)  
**This repo:** Research, audits, proposals, and copy-paste implementation prompts.

---

## 📂 Structure

```
├── DOROTHY-AUDIT.md          # Master tracking board
├── audit-reports/            # Full codebase audit (Feb 15, 2026)
│   ├── pick-engine-audit.md  # 9+ findings (1 critical, 5 high)
│   ├── security-audit.md     # 12 findings (1 high)
│   ├── data-quality-audit.md # 16 findings (4 high)
│   ├── frontend-audit.md     # 28 findings (1 critical, 7 high)
│   ├── architecture-audit.md # 14 findings (3 critical, 5 high)
│   └── edge-research.md      # 18 new signal opportunities
├── proposals/                # Fix/feature proposals (pending review)
└── prompts/                  # Accepted → ready-to-paste Claude prompts
```

## 📊 Audit Summary (Feb 15, 2026)

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Pick Engine | 1 | 5 | 3 | — |
| Security | 0 | 1 | 5 | 6 |
| Data Quality | 0 | 4 | 6 | 6 |
| Frontend | 1 | 7 | 12 | 8 |
| Architecture | 3 | 5 | 6 | — |
| **Total** | **5** | **22** | **32** | **20** |

Plus 18 new edge/signal opportunities identified.

## 🔄 Workflow

1. Dorothy scans trendline repo (read-only)
2. Findings logged in `audit-reports/`
3. Proposals written in `proposals/`
4. Seanny reviews → accepts or skips
5. Accepted items → implementation prompt in `prompts/`
6. Seanny feeds prompt to Claude on main repo
