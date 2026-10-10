"""Generate self-contained, unexecuted Colab notebooks from the adjacent scripts."""
import json
from pathlib import Path

ROOT = Path(__file__).parent


def cell(kind, text):
    result = {"cell_type": kind, "metadata": {}, "source": text.splitlines(keepends=True)}
    if kind == "code":
        result.update(execution_count=None, outputs=[])
    return result


for number, title, script, data in [
    (3, "Supplier performance scoring", "model3_supplier_scoring.py", "supplier_performance.csv"),
    (4, "Expiry risk classification", "model4_expiry_risk.py", "batch_expiry_dataset.csv"),
]:
    cells = [cell("markdown", f"# Model {number}: {title}\n\nSynthetic-data development experiment. Read the system guide before interpreting results. These notebooks do not verify or replace your existing Models 1 and 2. CPU runtime is sufficient.\n\nRun cells in order. Outputs are saved to a new timestamped Drive folder.\n"),
             cell("markdown", "## 1. Dependencies\nRestart the runtime if requested after installation. The final cell saves the exact installed versions for reproducibility.\n"),
             cell("code", '%pip install -q "pandas>=2,<3" "numpy>=1.26,<3" "scikit-learn>=1.4,<2" joblib matplotlib\n'),
             cell("markdown", "## 2. Mount Drive and locate the original dataset\nUpload the original CSV to `MyDrive/PharmacyDSS/data/raw/`. Edit ROOT if your folder differs. No input files are modified.\n"),
             cell("code", f'from google.colab import drive\ndrive.mount("/content/drive")\nfrom pathlib import Path\nfrom datetime import datetime, timezone\nimport subprocess, sys, json\nimport pandas as pd\nROOT = Path("/content/drive/MyDrive/PharmacyDSS")\nDATA = ROOT / "data/raw/{data}"\nassert DATA.is_file(), f"Upload the dataset here: {{DATA}}"\nOUT = ROOT / "runs/model{number}" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")\nOUT.mkdir(parents=True, exist_ok=False)\nraw = pd.read_csv(DATA)\nprint("Shape:", raw.shape)\nprint("Missing values:", int(raw.isna().sum().sum()))\ndisplay(raw.head())\n'),
             cell("markdown", "## 3. Write the reusable experiment script\nThis cell embeds the complete script. Keep it with the artifact bundle for review and reproduction.\n"),
             cell("code", f"%%writefile /content/{script}\n" + (ROOT / script).read_text(encoding="utf-8"))]
    if number == 3:
        cells += [cell("markdown", "## 4. Run the scorecard\nThe cutoff excludes deliveries not yet observed. Weights and tier thresholds are proposed policy choices, not learned truth. The score only covers completed orders; operational overdue-order alerts remain separate. Set CLUSTERS to True only for exploratory analysis of these 12 synthetic suppliers.\n"),
                  cell("code", 'AS_OF = "2024-12-31"\nCLUSTERS = False\ncommand = [sys.executable, "/content/model3_supplier_scoring.py", "--data", str(DATA), "--output", str(OUT), "--as-of", AS_OF]\nif CLUSTERS:\n    command.append("--clusters")\nsubprocess.run(command, check=True)\n'),
                  cell("markdown", "## 5. Review score contributions and sensitivity\nLarge rank ranges indicate dependence on the proposed weights. Public charts use supplier IDs so simulated results are not mistaken for actual company ratings.\n"),
                  cell("code", 'import matplotlib.pyplot as plt\nscores = pd.read_csv(OUT / "supplier_scores.csv")\ndisplay(scores)\ndisplay(pd.read_csv(OUT / "rank_ranges.csv"))\ncolumns = ["contribution_on_time", "contribution_fulfillment", "contribution_price", "contribution_quality"]\nscores.set_index("supplier_id")[columns].plot.barh(stacked=True, figsize=(10, 6))\nplt.title("Synthetic supplier score contributions")\nplt.xlabel("Score points (0–100)")\nplt.tight_layout()\nplt.savefig(OUT / "score_contributions.png", dpi=150)\nplt.show()\n')]
    else:
        cells += [cell("markdown", "## 4. Run the synthetic expiry experiment\nTraining/validation examples must have expiry before the next partition. This conservative label-maturity proxy drops many rows. The final test includes future-dated simulated records and is not evidence of prospective real-world performance. The validation recall target is an experiment setting, not a guaranteed operating result.\n"),
                  cell("code", 'subprocess.run([sys.executable, "/content/model4_expiry_risk.py", "--data", str(DATA), "--output", str(OUT), "--recall-target", "0.85"], check=True)\n'),
                  cell("markdown", "## 5. Review the test once after selection\nCompare the selected model against the rule and inspect class counts, segment failures and alert workload. Do not tune using these results and still call this an untouched test. Obtain another test period for later revisions.\n"),
                  cell("code", 'import matplotlib.pyplot as plt\nfrom sklearn.metrics import ConfusionMatrixDisplay\nmetadata = json.loads((OUT / "metadata.json").read_text())\nprint(json.dumps(metadata, indent=2))\ndisplay(pd.read_json(OUT / "segment_metrics.json"))\npredictions = pd.read_csv(OUT / "test_predictions.csv")\nConfusionMatrixDisplay.from_predictions(predictions.at_risk_label, predictions.predicted, display_labels=["No unused expiry", "Unused expiry"])\nplt.title("Synthetic expiry test: selected classifier")\nplt.tight_layout()\nplt.savefig(OUT / "confusion_matrix.png", dpi=150)\nplt.show()\n')]
    cells += [cell("markdown", "## 6. Save the environment and script\nThe exported outputs are candidates. Add reviewed feature schemas, golden examples and a model card before Django promotion. Only load your own trusted joblib artifacts in a compatible environment.\n"),
              cell("code", f'import shutil\nlock = subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True)\n(OUT / "requirements-lock.txt").write_text(lock)\nshutil.copyfile("/content/{script}", OUT / "{script}")\nprint("Results saved:", OUT)\nprint("\\n".join(p.name for p in sorted(OUT.iterdir())))\n')]
    notebook = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}, "colab": {"provenance": []}}, "nbformat": 4, "nbformat_minor": 5}
    # Stable cell IDs make notebooks valid under nbformat 4.5.
    for i, c in enumerate(cells):
        c["id"] = f"model{number}-cell-{i:02d}"
    name = "03_supplier_scoring.ipynb" if number == 3 else "04_expiry_risk.ipynb"
    (ROOT / name).write_text(json.dumps(notebook, indent=2), encoding="utf-8")
    print(name)
