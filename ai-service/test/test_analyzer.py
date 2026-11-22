from __future__ import annotations

import unittest

import trimesh

from app.analyzer import (
    MAX_FILE_BYTES,
    MAX_TRIANGLES,
    AnalysisSettings,
    analyze_mesh,
)
from unittest.mock import patch

def tetrahedron_obj() -> bytes:
    return b"""\
v 0 0 0
v 20 0 0
v 0 20 0
v 0 0 20
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
"""


def open_triangle_obj() -> bytes:
    return b"""\
v 0 0 0
v 20 0 0
v 0 20 0
f 1 2 3
"""


class AnalyzeMeshTests(unittest.TestCase):
    def test_checks_valid_obj_geometry_and_returns_measurements(self) -> None:
        report = analyze_mesh(tetrahedron_obj(), "tetrahedron.obj")

        self.assertEqual(report["status"], "review")
        self.assertEqual(report["dimensions_mm"], [20.0, 20.0, 20.0])
        self.assertEqual(report["triangle_count"], 4)
        self.assertTrue(report["is_watertight"])
        self.assertEqual(report["component_count"], 1)
        self.assertGreater(report["volume_mm3"], 0)
        self.assertEqual(report["build_volume_mm"], [220.0, 220.0, 250.0])
        self.assertIn(
            "overhangs",
            {issue["code"] for issue in report["issues"]},
        )
        self.assertTrue(any("units" in limitation.lower() for limitation in report["limitations"]))

    def test_loads_stl_with_duplicated_triangle_vertices(self) -> None:
        box = trimesh.creation.box(extents=(20, 30, 40))
        stl_contents = bytes(box.export(file_type="stl"))

        report = analyze_mesh(stl_contents, "box.stl")

        self.assertTrue(report["is_watertight"])
        self.assertEqual(report["dimensions_mm"], [20.0, 30.0, 40.0])
        self.assertEqual(report["triangle_count"], 12)

    def test_flags_open_mesh_as_a_failure(self) -> None:
        report = analyze_mesh(open_triangle_obj(), "open.obj")

        self.assertEqual(report["status"], "fail")
        self.assertFalse(report["is_watertight"])
        self.assertIn(
            "non_watertight",
            {issue["code"] for issue in report["issues"]},
        )

    def test_flags_models_outside_the_configured_build_volume(self) -> None:
        report = analyze_mesh(
            tetrahedron_obj(),
            "part.obj",
            AnalysisSettings(build_volume_mm=(10, 10, 10)),
        )

        self.assertEqual(report["status"], "fail")
        self.assertIn(
            "exceeds_build_volume",
            {issue["code"] for issue in report["issues"]},
        )

    def test_rejects_empty_unsupported_and_oversized_files(self) -> None:
        with self.assertRaisesRegex(ValueError, "empty"):
            analyze_mesh(b"", "empty.obj")
        with self.assertRaisesRegex(ValueError, "STL or OBJ"):
            analyze_mesh(tetrahedron_obj(), "model.gcode")
        with self.assertRaisesRegex(ValueError, "25 MB"):
            analyze_mesh(b"x" * (MAX_FILE_BYTES + 1), "large.obj")

    def test_rejects_malformed_meshes(self) -> None:
        with self.assertRaisesRegex(ValueError, "parsed|geometry"):
            analyze_mesh(b"this is not a mesh", "broken.obj")


    def test_rejects_oversized_binary_stl_before_loading(self) -> None:
        triangle_count = MAX_TRIANGLES + 1
        contents = (
            bytes(80)
            + triangle_count.to_bytes(4, "little")
            + bytes(triangle_count * 50)
        )

        with patch("app.analyzer.trimesh.load") as mesh_loader:
            with self.assertRaisesRegex(ValueError, "500,000 triangles"):
                analyze_mesh(contents, "large.stl")

            mesh_loader.assert_not_called()

    def test_rejects_oversized_ascii_stl_before_loading(self) -> None:
        contents = b"solid test\n" + (
            b"facet normal 0 0 1\n" * (MAX_TRIANGLES + 1)
        )

        with patch("app.analyzer.trimesh.load") as mesh_loader:
            with self.assertRaisesRegex(ValueError, "500,000 triangles"):
                analyze_mesh(contents, "large.stl")

            mesh_loader.assert_not_called()

    def test_rejects_oversized_obj_before_loading(self) -> None:
        contents = (
            b"v 0 0 0\n"
            b"v 1 0 0\n"
            b"v 0 1 0\n"
            + b"f 1 2 3\n" * (MAX_TRIANGLES + 1)
        )

        with patch("app.analyzer.trimesh.load") as mesh_loader:
            with self.assertRaisesRegex(ValueError, "500,000 triangles"):
                analyze_mesh(contents, "large.obj")

            mesh_loader.assert_not_called()

    def test_counts_obj_polygon_faces_as_multiple_triangles(self) -> None:
        # A polygon with 500,003 vertices represents 500,001 triangles.
        face = b"f " + b"1 " * (MAX_TRIANGLES + 3) + b"\n"

        with patch("app.analyzer.trimesh.load") as mesh_loader:
            with self.assertRaisesRegex(ValueError, "500,000 triangles"):
                analyze_mesh(face, "large.obj")

            mesh_loader.assert_not_called()
    def test_rejects_malformed_binary_stl_before_loading(self) -> None:
        # Binary-looking header with an impossible declared file size.
        contents = (
            b"\x00" * 80
            + (10).to_bytes(4, "little")
            + bytes(50)
        )

        with patch("app.analyzer.trimesh.load") as mesh_loader:
            with self.assertRaisesRegex(ValueError, "invalid structure"):
                analyze_mesh(contents, "malformed.stl")

            mesh_loader.assert_not_called()
if __name__ == "__main__":
    unittest.main()
