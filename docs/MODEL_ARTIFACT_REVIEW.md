# Model Artifact Review Before Django Implementation

**Review date:** 21 September 2026  
**Scope:** the user's Demand, Reorder and supplier bundles under `ml/`, their duplicate copies, the previously supplied datasets, and the current frontend contracts.  
**Boundary:** inspection and inference checks only; no backend implementation, training or changes to the uploaded artifacts.

**Conclusion:** all three bundles are executable and internally consistent enough to begin backend integration work. Demand and supplier outputs reproduce their exported results; reorder outputs reproduce as well, with a confirmed numerical threshold-boundary sensitivity. Remaining work is principally versioned preprocessing, stable decision semantics, API mapping and evaluation provenance. This is an integration-readiness conclusion, not production approval.

## 1. Bundle inventory

| Bundle | Files supplied | Intended backend role |
|---|---|---|
| `ml/Demand` | Forecast model, category encoder, season encoder, metadata | Predict daily consumption from historical features |
| `ml/Reorder` | Risk classifier and metadata | Score stockout risk and apply the saved decision threshold |
| `ml/supplier` | MinMax scaler, K-means model, weights, scorecard CSV and metadata | Recompute a relative score and assign a supplier cluster/tier |

There are 11 files in the three primary bundles and 11 corresponding files under `ml/colab`. Every counterpart has the same SHA-256 hash. Keep `ml/Demand`, `ml/Reorder` and `ml/supplier` as the proposed authoritative locations; no duplicate has been deleted. A manifest is included in `model-review/artifact_audit.json`.

The binaries identify scikit-learn **1.6.1** as their serialization version. A separate `.ml-review.local` virtual environment was created for compatibility checks; it is ignored by the existing `*.local` Git rule. Its dependency snapshot records the review environment, not a recovered Colab lock file.

## 2. Demand bundle

The metadata declares a tuned Random Forest regressor, 750 trees, maximum depth 9, and 14 features in this exact order:

```text
medicine_id, category_enc, season_enc, day_of_week, month,
is_weekend, is_public_holiday, lag_1, lag_7, lag_14, lag_30,
rolling_mean_7, rolling_mean_30, rolling_std_7
```

Reported metrics are MAE **21.2966**, RMSE **40.7070**, and MAPE **33.6554%**. The metadata identifies 5,700 training rows and 1,020 test rows from the 2024 synthetic data.

### Backend requirements

- Preserve the dataset medicine IDs through an explicit external-key mapping. A newly assigned database primary key is not necessarily the model's medicine identity.
- Load both saved encoders and use their category/season vocabulary. Reject or explicitly handle unseen labels rather than silently mapping them to zero.
- Build a complete calendar-day history with at least 30 preceding observations. Distinguish missing records from verified zero demand and censored stockout days.
- Reproduce lag/rolling definitions, sorting, standard-deviation convention and holiday/season derivation. Feature engineering is not embedded in the regressor artifact.
- The estimator predicts one numeric daily target per feature row. A 7–90-day frontend forecast needs a separately implemented and evaluated recursive or direct multi-step procedure.
- No uncertainty estimator or validated interval artifact is supplied. Return nullable interval bounds until that capability is developed.

## 3. Reorder bundle

The metadata declares a Random Forest classifier with 300 trees, maximum depth 8, balanced class weights, and 21 ordered features. The input contains 11 numeric/indicator fields and 10 explicit category indicators. It states `requires_scaler: false`; the lack of a scaler file is therefore not itself an incomplete export.

Use the saved threshold **0.12461645022709879**, not a default 0.5:

```python
positive_index = list(model.classes_).index(1)
risk_score = model.predict_proba(feature_frame)[:, positive_index]
at_risk = risk_score >= metadata["decision_threshold"]
```

Reported precision is **0.5702**, recall **0.8025**, F1 **0.6667**, ROC-AUC **0.9629**, and average precision (labelled `pr_auc` in metadata) **0.8100**. An 80% validation/experimental recall target is not an operating guarantee.

### Backend requirements

- Construct the 21 columns exactly and preserve their order. Save the category encoding and zero-denominator rules as a versioned preprocessing contract.
- The omitted reference category is `Analgesic/Anti-inflammatory`. Its ten category indicators are all zero; unknown categories must be distinguished from that valid reference category.
- Use the training definition of `avg_daily_demand` and `demand_std_dev`. The supplied dataset uses historical demand statistics; replacing them with forecast outputs requires evaluation of that change.
- Calculate `demand_cv`, `lead_time_margin` and `lead_time_cv` consistently, including zero demand. Unknown categories should not become an accidental all-zero known class.
- Return a risk score and thresholded decision. This model does not predict an order quantity, supplier, cost, or purchase approval.
- Implement inventory position, incoming orders, reorder quantities, pack rounding and approval in Django services.

## 4. Supplier bundle

The four score features are:

| Feature | Direction | Weight |
|---|---|---:|
| `on_time_rate` | Higher is better | 0.35 |
| `avg_fulfillment_rate` | Higher is better | 0.30 |
| `avg_price_variance_pct` | Lower is better | 0.20 |
| `avg_defect_rate` | Lower is better | 0.15 |

The weights file and metadata agree. The exported CSV contains 12 supplier aggregates covering 6,000 orders. It stores `score` on a **0–1 scale**; the current frontend's progress bars and percentage displays expect 0–100.

K-means uses three clusters, and the scorecard labels six suppliers Preferred, five At-Risk and one Acceptable. These are not simple score thresholds: the Acceptable supplier has a score below two At-Risk suppliers. Cluster IDs have no inherent business meaning. Export and version the verified ID-to-tier mapping; do not assume cluster 0 is Preferred or sort cluster labels arbitrarily in Django.

**Verified transformation:** apply `supplier_scaler.transform()` to the four raw aggregates in metadata order, then invert columns 3 and 4 with `1 - scaled_value`. Both the weighted score and K-means consume those benefit-oriented features. This reproduces every score within **3.4 × 10^-16**, every exported tier, and the reported silhouette score. The correct mapping for this specific artifact is **0 → Acceptable, 1 → Preferred, 2 → At-Risk**. Feeding raw MinMax values to K-means fails to reproduce the tiers. The mapping must be reassessed if the cluster model is refitted.

The scaler has `clip=False` and was fitted on 12 supplier aggregates. Scores outside 0–1 are possible for new out-of-range aggregates; agree whether to flag, constrain the display, or introduce a revised scoring policy. Do not silently clip the classifier input and assume the same model semantics.

The metadata reports a silhouette score of 0.4549, agreement with a hierarchical clustering result, and high ranking stability under weight perturbation. Those are descriptive internal measures on 12 simulated suppliers, not supervised accuracy or evidence of actual company performance.

### Differences from the earlier example script

`ml/colab/model3_supplier_scoring.py` is an earlier proposed implementation. It uses different weights, aggregation choices, a fixed price transform and explicit score thresholds. It is **not** the exporter/serving implementation for this newly supplied bundle. Do not call that script to refresh these artifacts or substitute its tier policy without creating and evaluating a new version.

### Backend requirements

- Recover and version the order aggregation, feature order, MinMax transformation, cost-feature inversion, weighted-score formula and cluster mapping.
- Reuse the saved scaler at inference; do not refit it each API request. New aggregates outside the fitted range need an explicit policy and monitoring. Do not add clipping silently if it changes the trained transformation.
- Separate relative cohort standing from absolute service quality. Even a high relative score can coexist with a low actual on-time percentage.
- Keep the tier and supplier operational status separate. A cluster assignment must not automatically suspend a supplier.
- The CSV does not supply every field the frontend expects, such as contacts, average lead time, open orders or a price-consistency measure. Derive legitimate metrics from orders/master data or return unavailable values.
- The supplier metadata says one year of order data, while the previously supplied source covers 2023–2024 orders and deliveries into 2025. Correct the period description and add an assessment cutoff before historical scoring.

## 5. Evaluation and provenance gaps

The artifacts can establish executable estimators and exact feature names, but they do not preserve the complete training procedure. The earlier PDF code reused nominal test data during model selection; the new Reorder metadata still describes choosing between tuned and untuned variants by test performance. Do not call those results unbiased final-test evidence without the final notebook and split records.

The metadata's `training_date_range` fields span the full available feature/snapshot periods even though separate test-row counts are listed. They do not distinguish fitted, validation and test boundaries. Record those dates separately instead of interpreting the current field as proof that all dates were fitted.

Before promotion, add the final notebook or training script, a Colab environment lock, data hashes, split IDs, preprocessing contract, threshold-selection provenance, and golden examples. Reproducing a metric from the saved estimator confirms consistency; it does not fix test-set reuse or establish real-world generalisation.

## 6. Frontend integration implications

| Existing frontend contract | Required backend/adapter decision |
|---|---|
| `/medicines/{id}/forecast/?horizon=...` | Construct horizon forecasts from the daily estimator; identify unvalidated horizons |
| `Forecast.series.lower/upper` | Keep null when no validated intervals exist |
| Reorder `confidence` percentage | Replace/clarify as stockout risk score; do not manufacture decision certainty |
| Reorder quantity/cost/supplier | Calculate from inventory and procurement rules, not the binary classifier |
| Supplier `overallScore` | Convert exported fractional score to percentage exactly once |
| `onTimeDeliveryPct`, `qualityPct` | Convert rates once; quality derives from the documented defect definition |
| `priceConsistencyPct` | A price premium is not price variability; define a separate metric or rename the field |
| `leadTimeVarianceDays` | Distinguish variance (days squared) from standard deviation (days) |

The source plan can support beginning Django's catalogue, inventory, authentication and procurement foundation now. Before wiring model-powered endpoints, implement and test the versioned preprocessing and output contracts above. Expiry is outside these three supplied bundles and can initially use an explicit rule-based service.

## 7. Runtime verification

The six pickle objects loaded without warnings using Python 3.12.14, scikit-learn 1.6.1, NumPy 2.2.6, SciPy 1.15.3, pandas 2.2.3 and joblib 1.5.1. This is a verified local review combination, not evidence of the original Colab versions beyond the saved scikit-learn marker.

| Check | Result |
|---|---|
| Demand artifact and metadata | All 14 feature names/order and all declared hyperparameters match; 750 fitted trees |
| Demand prediction reconstruction | 1,020 rows, 11 November–31 December 2024; finite, nonnegative predictions; all reported metrics reproduce to numerical precision |
| Reorder artifact and metadata | All 21 feature names/order and declared hyperparameters match; 300 trees; class order `[0, 1]` |
| Reorder prediction reconstruction | 900 rows; ROC-AUC and average precision match exactly; threshold-dependent metrics match on repeat/serial evaluation, with the boundary effect below |
| Supplier primary score | All 12 scores reproduce to numerical precision |
| Supplier aggregates | Reconstructed from all 6,000 original orders and match the exported aggregates |
| Supplier clustering | Cost-inverted MinMax features reproduce the exported tiers and silhouette 0.4548618485 |
| Uploaded artifact integrity | All primary file hashes unchanged after review; duplicates match |

### Threshold-boundary detail

Risk-check ID **1976** has a positive label and a probability essentially equal to **0.12461645022709879**. Across the review runs, floating-point accumulation changed the decision for this one case. The first parallel run produced 64 true positives and 17 false negatives (recall **0.790123**); a repeat and single-threaded check produced 65 true positives and 16 false negatives (recall **0.802469**). False positives remained 49. Parallel-versus-serial probability differences were at most approximately **2.22 × 10^-16** in the diagnostic run.

The default threshold of 0.5 produced recall **0.617284**, so replacing the exported operating point with `.predict()` is a material behaviour change.

For the backend, specify inference thread settings and comparison precision explicitly, and add this boundary example to golden tests. Single-threaded inference reproduced the source outcome here and reduces nested worker/thread parallelism. If a rounded-comparison policy is chosen, document and validate it rather than silently modifying the saved threshold. In a future calibration pass, choose robust thresholds on validation scores, not by adjusting against this test result.

### What these checks do not establish

No model was retrained. No independent unseen evaluation dataset was used. The original notebook split and feature definitions were reconstructed to check compatibility, and the supplied data is synthetic. Final notebook execution history, original runtime lock files, valid multi-step forecast performance and operational generalisation remain unverified.

## 8. Recommended order before model endpoints

1. Freeze the authoritative artifact hashes and the verified review environment; keep the original Colab lock separately when available.
2. Create shared, versioned demand/reorder feature builders, including catalogue mappings, calendars, zero-demand handling and the reference category.
3. Encode the reconstructed supplier transformation and cluster mapping as explicit versioned policy. Keep supplier tier separate from approval status.
4. Add shape/unknown-input checks and deterministic golden inference tests, including reorder risk-check 1976.
5. Implement Django's catalogue, transactional stock movements, supplier offers and purchasing services; then connect model outputs to those services.
6. Align serializers with the frontend's field names, units, percentage scales and nullable values, then test the mock-to-live switch.

The old system guide remains useful for architecture. Its earlier proposed supplier formula and its earlier statements that Drive artifacts had not been inspected are superseded by this review of the newly copied bundles.

## Review files

- `model-review/artifact_audit.json`: hashes, fitted attributes, encoder vocabularies and executed checks.
- `model-review/supplier_reconstruction.csv`: original and reconstructed scores plus cluster diagnostics.
- `model-review/demand_smoke_example.json` and `reorder_smoke_example.json`: representative already-engineered inputs and outputs; they do not replace raw-data feature-builder tests.
- `model-review/requirements-review.txt`: the installed review environment.
- `ml/review/inspect_model_bundles.py`: repeatable audit utility; it does not alter saved artifacts.
