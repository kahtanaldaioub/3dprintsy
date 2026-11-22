from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from math import isfinite
from typing import Any

import numpy as np
import trimesh

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TRIANGLES = 500_000
MAX_VERTICES = 1_000_000
DEFAULT_BUILD_VOLUME_MM = (220.0, 220.0, 250.0)
DEFAULT_OVERHANG_ANGLE_DEGREES = 45.0
DEFAULT_MIN_OVERALL_DIMENSION_MM = 0.8
SUPPORTED_FORMATS = {"stl", "obj"}


@dataclass(frozen=True)
class AnalysisSettings:
    build_volume_mm: tuple[float, float, float] = DEFAULT_BUILD_VOLUME_MM
    max_overhang_angle_degrees: float = DEFAULT_OVERHANG_ANGLE_DEGREES
    min_overall_dimension_mm: float = DEFAULT_MIN_OVERALL_DIMENSION_MM

    def __post_init__(self) -> None:
        if len(self.build_volume_mm) != 3 or any(
            not isfinite(dimension) or dimension <= 0
            for dimension in self.build_volume_mm
        ):
            raise ValueError("Build volume must contain three positive dimensions.")
        if not 0 < self.max_overhang_angle_degrees < 90:
            raise ValueError("Overhang angle must be between 0 and 90 degrees.")
        if (
            not isfinite(self.min_overall_dimension_mm)
            or self.min_overall_dimension_mm <= 0
        ):
            raise ValueError("Minimum overall dimension must be positive.")



def _preflight_triangle_count(contents: bytes, file_format: str) -> None:
    """Reject oversized STL/OBJ meshes before loading them with trimesh."""
    if file_format == "stl":
        # Binary STL has an 80-byte header followed by a 4-byte
        # triangle count and 50 bytes per triangle.
        if len(contents) >= 84:
            binary_count = int.from_bytes(contents[80:84], "little")
            expected_size = 84 + binary_count * 50

            # A matching size identifies a structurally valid binary STL.
            if expected_size == len(contents):
                if binary_count > MAX_TRIANGLES:
                    raise ValueError(
                        f"The model exceeds the limit of {MAX_TRIANGLES:,} triangles."
                    )
                return

            # A non-ASCII header is strong evidence that this is a
            # malformed binary STL, not an ASCII STL.
            if b"\x00" in contents[:80]:
                raise ValueError("The binary STL file has an invalid structure.")

        # ASCII STL: count facet normal records before loading.
        triangle_count = 0

        for line in BytesIO(contents):
            parts = line.strip().lower().split()

            if len(parts) >= 2 and parts[:2] == [b"facet", b"normal"]:
                triangle_count += 1

                if triangle_count > MAX_TRIANGLES:
                    raise ValueError(
                        f"The model exceeds the limit of {MAX_TRIANGLES:,} triangles."
                    )

    elif file_format == "obj":
        # Count raw vertex records and triangulate polygon faces.
        triangle_count = 0
        vertex_count = 0

        for line in BytesIO(contents):
            parts = line.split(b"#", 1)[0].split()

            if not parts:
                continue

            if parts[0] == b"v":
                vertex_count += 1

                if vertex_count > MAX_VERTICES:
                    raise ValueError(
                        f"The model exceeds the limit of {MAX_VERTICES:,} vertices."
                    )

            elif parts[0] == b"f":
                face_vertex_count = len(parts) - 1

                if face_vertex_count >= 3:
                    triangle_count += face_vertex_count - 2

                    if triangle_count > MAX_TRIANGLES:
                        raise ValueError(
                            f"The model exceeds the limit of {MAX_TRIANGLES:,} triangles."
                        )
def _load_mesh(contents: bytes, file_format: str) -> trimesh.Trimesh:
    _preflight_triangle_count(contents, file_format)
    try:
        loaded: Any = trimesh.load(
            BytesIO(contents),
            file_type=file_format,
            force="mesh",
            process=True,
        )
    except (ValueError, TypeError, OSError, IndexError) as error:
        raise ValueError(
            "The file could not be parsed as a valid STL or OBJ mesh."
        ) from error

    if isinstance(loaded, trimesh.Scene):
        geometries = [
            geometry
            for geometry in loaded.geometry.values()
            if isinstance(geometry, trimesh.Trimesh) and not geometry.is_empty
        ]
        if not geometries:
            raise ValueError("The file does not contain any triangle geometry.")
        loaded = trimesh.util.concatenate(geometries)

    if not isinstance(loaded, trimesh.Trimesh) or loaded.is_empty:
        raise ValueError("The file does not contain any triangle geometry.")
    if loaded.faces.ndim != 2 or loaded.faces.shape[1] != 3:
        raise ValueError("Only triangle meshes are supported.")
    if len(loaded.faces) > MAX_TRIANGLES:
        raise ValueError(
            f"The model exceeds the limit of {MAX_TRIANGLES:,} triangles."
        )
    if file_format == "obj" and len(loaded.vertices) > MAX_VERTICES:
        raise ValueError(
            f"The model exceeds the limit of {MAX_VERTICES:,} vertices."
        )
    if len(loaded.vertices) > MAX_VERTICES:
        raise ValueError(
            f"The model exceeds the limit of {MAX_VERTICES:,} vertices."
        )
    if not np.isfinite(loaded.vertices).all():
        raise ValueError("The mesh contains invalid vertex coordinates.")

    return loaded


def analyze_mesh(
    contents: bytes,
    filename: str,
    settings: AnalysisSettings | None = None,
) -> dict[str, Any]:
    """Inspect one uploaded STL/OBJ mesh without modifying or storing it."""
    if not contents:
        raise ValueError("The uploaded model is empty.")
    if len(contents) > MAX_FILE_BYTES:
        raise ValueError("The model exceeds the 25 MB upload limit.")

    file_format = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if file_format not in SUPPORTED_FORMATS:
        raise ValueError("Upload an STL or OBJ model.")

    settings = settings or AnalysisSettings()
    mesh = _load_mesh(contents, file_format)
    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    dimensions = bounds[1] - bounds[0]
    if not np.isfinite(dimensions).all() or not np.any(dimensions > 0):
        raise ValueError("The mesh has invalid or zero-size dimensions.")

    issues: list[dict[str, str]] = []

    def add_issue(code: str, severity: str, title: str, detail: str) -> None:
        issues.append(
            {"code": code, "severity": severity, "title": title, "detail": detail}
        )

    zero_size_axes = np.flatnonzero(dimensions <= 1e-12)
    if len(zero_size_axes):
        axis_names = ("X", "Y", "Z")
        zero_axes = ", ".join(axis_names[int(axis)] for axis in zero_size_axes)
        add_issue(
            "zero_size_dimension",
            "error",
            "Model has no size on one or more axes",
            f"The bounding box has zero extent on {zero_axes}. This surface has no printable thickness on those axes.",
        )

    if not mesh.is_watertight:
        add_issue(
            "non_watertight",
            "error",
            "Mesh is open or non-manifold",
            "The mesh is not watertight. Repair holes and non-manifold edges before printing.",
        )

    if not mesh.is_winding_consistent:
        add_issue(
            "inconsistent_winding",
            "warning",
            "Face orientation is inconsistent",
            "Some faces point in inconsistent directions. Repair the mesh normals in a modeling tool.",
        )

    try:
        component_count = len(mesh.split(only_watertight=False))
    except (ValueError, TypeError, IndexError):
        component_count = 1
        add_issue(
            "components_unavailable",
            "warning",
            "Disconnected parts could not be checked",
            "The mesh component analysis did not complete; review the model before printing.",
        )

    if component_count > 1:
        add_issue(
            "disconnected_components",
            "warning",
            "Model has disconnected parts",
            f"The mesh contains {component_count} disconnected components. Check that each part is intentional.",
        )

    outside_axes = [
        axis
        for axis, (size, limit) in enumerate(
            zip(dimensions, settings.build_volume_mm, strict=True)
        )
        if size > limit
    ]
    if outside_axes:
        axis_names = ("X", "Y", "Z")
        axis_details = ", ".join(
            f"{axis_names[axis]} is {dimensions[axis]:.1f} mm "
            f"(limit {settings.build_volume_mm[axis]:.1f} mm)"
            for axis in outside_axes
        )
        add_issue(
            "exceeds_build_volume",
            "error",
            "Model exceeds the configured build volume",
            f"{axis_details}. Rotate or scale the model, or configure the correct printer volume.",
        )

    if np.min(dimensions) < settings.min_overall_dimension_mm:
        add_issue(
            "small_overall_dimension",
            "warning",
            "One overall dimension is very small",
            f"The smallest bounding-box dimension is {np.min(dimensions):.2f} mm. This is not a wall-thickness measurement; check thin features separately.",
        )

    area_faces = np.asarray(mesh.area_faces, dtype=np.float64)
    if not np.isfinite(area_faces).all():
        raise ValueError("The mesh is outside the supported numeric range.")
    surface_area = float(area_faces.sum())
    if not isfinite(surface_area):
        raise ValueError("The mesh is outside the supported numeric range.")

    degenerate_face_count = int(np.count_nonzero(area_faces <= 1e-12))
    if degenerate_face_count:
        add_issue(
            "degenerate_faces",
            "error",
            "Mesh contains degenerate faces",
            f"{degenerate_face_count} triangle(s) have effectively zero area. Repair the mesh before printing.",
        )

    signed_volume = float(mesh.volume) if mesh.is_watertight else None
    if signed_volume is not None and not isfinite(signed_volume):
        raise ValueError("The mesh is outside the supported numeric range.")
    if (
        mesh.is_watertight
        and mesh.is_winding_consistent
        and signed_volume is not None
        and signed_volume != 0
    ):
        if signed_volume < 0:
            mesh.invert()
        overhang_faces = mesh.face_normals[:, 2] < -np.sin(
            np.deg2rad(settings.max_overhang_angle_degrees)
        )
        overhang_area = float(area_faces[overhang_faces].sum())
        overhang_ratio = overhang_area / surface_area if surface_area > 0 else 0.0
        if overhang_ratio >= 0.05:
            add_issue(
                "overhangs",
                "warning",
                "Potential overhangs in the uploaded orientation",
                f"About {overhang_ratio * 100:.1f}% of the surface faces may need support at the configured {settings.max_overhang_angle_degrees:.0f}° overhang threshold. Reorientation can change this result.",
            )
    else:
        overhang_ratio = None
        add_issue(
            "overhangs_not_assessed",
            "warning",
            "Overhangs could not be assessed reliably",
            "This check needs a closed mesh with consistent face orientation and positive volume. Inspect the mesh and orientation before printing.",
        )

    if signed_volume is not None:
        signed_volume = abs(signed_volume)

    if any(issue["severity"] == "error" for issue in issues):
        status = "fail"
        summary = "Important mesh or size problems need attention before printing."
    elif issues:
        status = "review"
        summary = "Review the warnings before requesting a print."
    else:
        status = "pass"
        summary = "No issues were found by the checks available in this first-pass analysis."

    return {
        "status": status,
        "summary": summary,
        "units": "mm (assumed; STL and OBJ files do not reliably specify units)",
        "dimensions_mm": [round(float(value), 3) for value in dimensions],
        "build_volume_mm": list(settings.build_volume_mm),
        "triangle_count": int(len(mesh.faces)),
        "component_count": component_count,
        "is_watertight": bool(mesh.is_watertight),
        "is_winding_consistent": bool(mesh.is_winding_consistent),
        "volume_mm3": round(signed_volume, 3) if signed_volume is not None else None,
        "surface_area_mm2": round(surface_area, 3),
        "overhang_surface_ratio": (
            round(overhang_ratio, 4) if overhang_ratio is not None else None
        ),
        "settings": {
            "max_overhang_angle_degrees": settings.max_overhang_angle_degrees,
            "minimum_overall_dimension_mm": settings.min_overall_dimension_mm,
        },
        "limitations": [
            "STL and OBJ units are not reliable; dimensions are assumed to be millimeters.",
            "Overhang analysis uses the uploaded orientation and is an estimate, not a slicing simulation.",
            "Local wall thickness, bed adhesion, material-specific limits, and print success are not measured.",
            "Build-volume results use the configured rectangular volume, not the actual printable region of a specific machine.",
        ],
        "issues": issues,
    }
