# Colab model development package

Start with [the system guide](../../docs/SYSTEM_DESIGN_AND_DEVELOPMENT_GUIDE.md).

## Files

- `03_supplier_scoring.ipynb`: self-contained Colab notebook for an explainable supplier scorecard.
- `04_expiry_risk.ipynb`: self-contained Colab notebook for a rule baseline and experimental expiry classifier.
- `model3_supplier_scoring.py`, `model4_expiry_risk.py`: reusable script equivalents. Each notebook embeds its script, so uploading the notebook alone is sufficient.
- `build_notebooks.py`: rebuilds the notebook files after script changes.

## Run in Google Colab

1. Upload the original datasets to `MyDrive/PharmacyDSS/data/raw/`.
2. Open Google Colab and upload one of the notebooks.
3. Run the dependency cell. Restart the runtime if Colab requests it.
4. Run the Drive-mount cell and approve your own Drive access.
5. Check `ROOT`. Run all remaining cells in order.
6. Inspect the outputs and saved metrics before interpreting the model.

Results are written to `MyDrive/PharmacyDSS/runs/<model>/<UTC timestamp>/`. A dependency snapshot is saved with each run. Both scripts use CPU; a GPU is unnecessary.

Model 3 defaults to a 31 December 2024 historical assessment. Optional clustering is off by default. Scores describe synthetic data and must not be published as real supplier ratings.

Model 4 uses outcome-mature training/validation partitions and a synthetic future evaluation period. It does not claim prospective validity. Validation selects the estimator and threshold; the fitted estimator is not changed after threshold selection. The output remains `production_approved: false`. Real deployment needs mature real outcomes, broader validation, a model card and reviewed integration tests.

## Run the scripts directly

```bash
python model3_supplier_scoring.py --data supplier_performance.csv --output outputs/model3 --as-of 2024-12-31
python model4_expiry_risk.py --data batch_expiry_dataset.csv --output outputs/model4 --recall-target 0.85
```

Create a distinct output directory per run; scripts write named files inside it. The scripts do not alter input CSVs. The original Models 1 and 2 have not been overwritten or retrained by this package.

## Validation performed for this delivery

See `../../docs/VALIDATION_NOTES.md` for the checks actually executed. Colab execution and learned expiry-model metrics must be produced in your Colab runtime; they are not fabricated in this package.
