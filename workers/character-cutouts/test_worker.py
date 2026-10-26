import tempfile
import unittest
from pathlib import Path

from worker import cgroup_metrics


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


if __name__ == "__main__":
    unittest.main()
