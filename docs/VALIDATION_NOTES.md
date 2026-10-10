# Delivery validation record

Date: 20 September 2026.

## Executed

- Read both complete PDF text exports (16 and 31 pages); visually inspected relevant feature, split, comparison and final-result pages. The second PDF stops before a complete final export record.
- Profiled all four CSVs directly; saved the observed schema, dates and label counts in `DATASET_PROFILE.json`.
- Ran the complete primary Model 3 scorecard against the supplied supplier file, including weight sensitivity and adjacent-period comparisons. It completed successfully for 12 suppliers.
- Checked score bounds, arithmetic reconciliation of component contributions, exclusion of future deliveries, and rejection of a zero market reference price.
- Exercised Model 4's pure feature, baseline-rule and date-splitting functions independently of scikit-learn. Confirmed finite inputs, zero-stock/zero-demand cases, distinct batches across partitions and outcome-mature training/validation dates.
- Confirmed retained expiry partition sizes: 1,254 training, 122 validation, 560 test. The remaining 4,064 rows are excluded by label-maturity conditions in earlier partitions.
- Parsed all supplied Python scripts and all Python notebook cells after removing Colab magic headers. Checked notebook JSON structure, unique cell IDs and empty execution outputs.
- Checked that the guide's fenced code blocks are balanced.

## Not executed or verified

- Full scikit-learn fitting for Model 4, optional supplier clustering, and Colab-specific installation/Drive mounting. The local bundled runtime does not include scikit-learn. No learned Model 4 performance results have been invented.
- Models 1 and 2 were not retrained. Their saved Drive artifacts were not retrieved, loaded or altered. PDF metrics are reported as source observations, with evaluation limitations.
- No Django backend was implemented, migrated, served or deployed during this documentation task. Its commands, schema and endpoint design are implementation instructions.
- No operational clinical validation, real supplier ranking or real-world inventory reconciliation is claimed.

## Repository boundary

Deliverables are documentation and model-development files. The existing frontend source was not intentionally edited. `src/routeTree.gen.ts` already appeared modified when this work began; that generated-file state was preserved.
