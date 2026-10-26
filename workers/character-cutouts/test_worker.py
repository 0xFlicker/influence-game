import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker import cgroup_metrics, run_job


class CgroupMetricsTest(unittest.TestCase):
    def metrics(self, files):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value)
            return cgroup_metrics(root)

    def test_docker_cgroup_v2(self):
        self.assertEqual(self.metrics({"cpu.max": "200000 100000\n", "memory.max": "17179869184", "memory.peak": "9483616256"}),
                         {"cpu_max": "200000 100000", "memory_max": "17179869184", "cgroup_peak_bytes": 9483616256})

    def test_fargate_cgroup_v1(self):
        self.assertEqual(self.metrics({"cpu/cpu.cfs_quota_us": "200000", "cpu/cpu.cfs_period_us": "100000",
                                       "memory/memory.limit_in_bytes": "17179869184", "memory/memory.max_usage_in_bytes": "9483616256"}),
                         {"cpu_max": "200000 100000", "memory_max": "17179869184", "cgroup_peak_bytes": 9483616256})

    def test_combined_cpu_mount(self):
        self.assertEqual(self.metrics({"cpu,cpuacct/cpu.cfs_quota_us": "-1", "cpu,cpuacct/cpu.cfs_period_us": "100000"})["cpu_max"], "-1 100000")

    def test_unexposed_diagnostics_are_explicitly_unavailable(self):
        self.assertEqual(self.metrics({}), {"cpu_max": None, "memory_max": None, "cgroup_peak_bytes": None})


class WorkerRequestTest(unittest.TestCase):
    def test_claim_identifies_service_and_keeps_capability_auth(self):
        env = {"CUTOUT_API_URL": "https://thehouse.game", "CUTOUT_JOB_ID": "test-job", "CUTOUT_JOB_TOKEN": "test-token"}
        with patch.dict("os.environ", env), patch("worker.urllib.request.urlopen", return_value=io.BytesIO(b'{"claimed":false}')) as request:
            run_job(None)
        req = request.call_args.args[0]
        self.assertEqual(req.get_header("User-agent"), "HouseCharacterCutouts/1.0")
        self.assertEqual(req.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(req.full_url, "https://thehouse.game/api/internal/cutouts/test-job/claim")


if __name__ == "__main__":
    unittest.main()
