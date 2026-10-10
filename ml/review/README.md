# Model bundle review

Read `docs/MODEL_ARTIFACT_REVIEW.md` for the findings.

From the repository root, repeat the audit in the isolated review environment:

```powershell
.\.ml-review.local\Scripts\python.exe ml/review/inspect_model_bundles.py --datasets "C:/Users/McDtronix/Downloads/PharmacyProject/files"
```

The script reads the owner's trusted local model exports. Do not run it against unknown pickle files. It writes diagnostics under `docs/model-review/` and never trains or saves over the supplied model files.

The dependency snapshot is `docs/model-review/requirements-review.txt`. It describes a locally tested environment, not the original Colab training environment. The test-period reconstructions verify compatibility and reported-result consistency; they are not new unbiased performance evaluations.

Outputs may differ in the last floating-point digits between parallel runs. The report documents the one saved-threshold boundary case found during review.
