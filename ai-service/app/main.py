from __future__ import annotations

import os
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.analyzer import (
    DEFAULT_MIN_OVERALL_DIMENSION_MM,
    MAX_FILE_BYTES,
    AnalysisSettings,
    analyze_mesh,
)


def _build_volume_from_environment() -> tuple[float, float, float]:
    value = os.getenv("PRINTER_BUILD_VOLUME_MM", "220,220,250")
    try:
        dimensions = tuple(float(part.strip()) for part in value.split(","))
    except ValueError as error:
        raise ValueError(
            "PRINTER_BUILD_VOLUME_MM must contain three comma-separated numbers."
        ) from error
    if len(dimensions) != 3:
        raise ValueError(
            "PRINTER_BUILD_VOLUME_MM must contain three comma-separated numbers."
        )
    return dimensions


settings = AnalysisSettings(
    build_volume_mm=_build_volume_from_environment(),
    max_overhang_angle_degrees=float(os.getenv("MAX_OVERHANG_ANGLE_DEGREES", "45")),
    min_overall_dimension_mm=float(
        os.getenv("MIN_OVERALL_DIMENSION_MM", str(DEFAULT_MIN_OVERALL_DIMENSION_MM))
    ),
)
app = FastAPI(
    title="KD Prints Printability Service",
    version="0.1.0",
    description="First-pass rule-based STL/OBJ mesh analysis for the KD Prints platform.",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(
    model: Annotated[UploadFile, File(description="STL or OBJ model, maximum 25 MB")]
) -> dict:
    filename = model.filename or ""
    try:
        contents = await model.read(MAX_FILE_BYTES + 1)
    finally:
        await model.close()

    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The model exceeds the 25 MB upload limit.")

    try:
        return await run_in_threadpool(analyze_mesh, contents, filename, settings)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
