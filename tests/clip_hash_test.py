import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/imagegen-swarm/scripts"))
import imgtool


class ClipHashTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.model = Path(temp.name) / "fixture.onnx"
        self.model.write_bytes(b"offline model fixture")
        self.sha = hashlib.sha256(self.model.read_bytes()).hexdigest()
        self.runtime = Mock()
        modules = patch.dict(sys.modules, {"numpy": types.ModuleType("numpy"), "onnxruntime": self.runtime})
        modules.start()
        self.addCleanup(modules.stop)
        environment = patch.dict(imgtool.os.environ, {"IMAGE_GEN_CLIP_MODEL": str(self.model),
                                                      "IMAGE_GEN_CLIP_ALLOW_UNVERIFIED": ""})
        environment.start()
        self.addCleanup(environment.stop)

    def test_unverified_is_rejected_before_loading(self):
        status = imgtool.clip_status()
        self.assertEqual(status["sha256"], self.sha)
        self.assertFalse(status["available"])
        self.assertEqual(imgtool.backends()["auto"], "structure")
        with self.assertRaisesRegex(SystemExit, "not one of the validated models"):
            imgtool._Clip()
        self.runtime.InferenceSession.assert_not_called()

    def test_only_exact_opt_in_loads_unverified(self):
        self.runtime.InferenceSession.return_value.get_inputs.return_value = [types.SimpleNamespace(name="pixels")]
        with patch.dict(imgtool.os.environ, {"IMAGE_GEN_CLIP_ALLOW_UNVERIFIED": "YES"}):
            self.assertFalse(imgtool.clip_status()["available"])
        with patch.dict(imgtool.os.environ, {"IMAGE_GEN_CLIP_ALLOW_UNVERIFIED": "yes"}):
            self.assertTrue(imgtool.clip_status()["available"])
            imgtool._Clip()
        self.runtime.InferenceSession.assert_called_once()

    def test_known_hash_passes_without_override(self):
        with patch.dict(imgtool.CLIP_KNOWN_SHA256, {self.sha: "fixture"}):
            self.assertEqual(imgtool.clip_status()["known_model"], "fixture")
            self.assertTrue(imgtool.clip_status()["available"])

    def test_missing_model_stays_optional_even_with_override(self):
        self.model.unlink()
        with patch.dict(imgtool.os.environ, {"IMAGE_GEN_CLIP_ALLOW_UNVERIFIED": "yes"}):
            self.assertIn("model file not found", imgtool.clip_status()["reason"])
            self.assertEqual(imgtool.backends()["auto"], "structure")


if __name__ == "__main__":
    unittest.main(verbosity=2)
