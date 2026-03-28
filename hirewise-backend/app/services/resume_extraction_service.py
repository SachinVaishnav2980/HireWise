import re
import importlib
from typing import Dict, List, Tuple

import pdfplumber

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - optional runtime dependency
    fitz = None

pytesseract = None
try:
    pytesseract = importlib.import_module("pytesseract")
except Exception:  # pragma: no cover - optional runtime dependency
    pytesseract = None

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional runtime dependency
    Image = None


class ResumeExtractionService:
    """
    Robust resume text extraction with confidence estimation.

    Pipeline:
    1) pdfplumber extraction
    2) PyMuPDF text extraction fallback
    3) OCR fallback (PyMuPDF rendering + Tesseract)

    Returns extraction confidence (high/medium/low) based on:
    - text length
    - readable word ratio
    - garbled text ratio
    """

    MIN_MEDIUM_TEXT_LENGTH = 220
    MIN_HIGH_TEXT_LENGTH = 500

    def extract_with_confidence(self, file_path: str) -> Dict:
        warnings: List[str] = []
        candidates: List[Tuple[str, str]] = []

        pdfplumber_text = self._extract_with_pdfplumber(file_path)
        if pdfplumber_text:
            candidates.append(("pdfplumber", pdfplumber_text))

        pymupdf_text = self._extract_with_pymupdf(file_path)
        if pymupdf_text:
            candidates.append(("pymupdf", pymupdf_text))

        # Pick best candidate by readable content quality
        best_method = "none"
        best_text = ""
        best_score = -1.0

        for method, text in candidates:
            metrics = self._compute_quality_metrics(text)
            quality_score = (
                min(metrics["text_length"], 2500) / 2500
                + metrics["readable_word_ratio"]
                + (1 - metrics["garbled_ratio"])
            )
            if quality_score > best_score:
                best_score = quality_score
                best_text = text
                best_method = method

        # OCR fallback when extraction is weak or empty
        if not best_text or len(best_text) < self.MIN_MEDIUM_TEXT_LENGTH:
            ocr_text = self._extract_with_ocr(file_path)
            if ocr_text:
                warnings.append("Used OCR fallback for extraction")
                ocr_metrics = self._compute_quality_metrics(ocr_text)
                current_metrics = self._compute_quality_metrics(best_text)
                if ocr_metrics["readable_word_ratio"] >= current_metrics["readable_word_ratio"]:
                    best_text = ocr_text
                    best_method = "ocr"

        metrics = self._compute_quality_metrics(best_text)
        confidence = self._classify_confidence(metrics)

        if confidence == "low":
            warnings.append("Low extraction confidence")
        if metrics["garbled_ratio"] > 0.30:
            warnings.append("Extracted text appears garbled")
        if metrics["readable_word_ratio"] < 0.45:
            warnings.append("Readable word ratio is low")

        return {
            "text": best_text,
            "confidence": confidence,
            "method": best_method,
            "metrics": metrics,
            "warnings": warnings,
        }

    def _extract_with_pdfplumber(self, file_path: str) -> str:
        text_chunks: List[str] = []
        try:
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    if page_text.strip():
                        text_chunks.append(page_text)
        except Exception:
            return ""
        return "\n".join(text_chunks).strip()

    def _extract_with_pymupdf(self, file_path: str) -> str:
        if fitz is None:
            return ""

        text_chunks: List[str] = []
        try:
            doc = fitz.open(file_path)
            for page in doc:
                page_text = page.get_text("text") or ""
                if page_text.strip():
                    text_chunks.append(page_text)
            doc.close()
        except Exception:
            return ""

        return "\n".join(text_chunks).strip()

    def _extract_with_ocr(self, file_path: str) -> str:
        if fitz is None or pytesseract is None or Image is None:
            return ""

        text_chunks: List[str] = []
        try:
            doc = fitz.open(file_path)
            for page in doc:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                ocr_text = pytesseract.image_to_string(image)
                if ocr_text and ocr_text.strip():
                    text_chunks.append(ocr_text)
            doc.close()
        except Exception:
            return ""

        return "\n".join(text_chunks).strip()

    def _compute_quality_metrics(self, text: str) -> Dict[str, float]:
        if not text:
            return {
                "text_length": 0,
                "token_count": 0,
                "readable_word_ratio": 0.0,
                "garbled_ratio": 1.0,
            }

        tokens = re.findall(r"\S+", text)
        readable_words = re.findall(r"\b[a-zA-Z]{2,}\b", text)

        # Count suspicious characters (high symbol noise indicates extraction issues)
        suspicious_chars = re.findall(r"[^\w\s\.,;:()/%@\-+&]", text)
        garbled_ratio = len(suspicious_chars) / max(len(text), 1)

        readable_word_ratio = len(readable_words) / max(len(tokens), 1)

        return {
            "text_length": float(len(text)),
            "token_count": float(len(tokens)),
            "readable_word_ratio": float(round(readable_word_ratio, 4)),
            "garbled_ratio": float(round(garbled_ratio, 4)),
        }

    def _classify_confidence(self, metrics: Dict[str, float]) -> str:
        text_length = metrics.get("text_length", 0)
        readable_ratio = metrics.get("readable_word_ratio", 0)
        garbled_ratio = metrics.get("garbled_ratio", 1)

        if (
            text_length >= self.MIN_HIGH_TEXT_LENGTH
            and readable_ratio >= 0.65
            and garbled_ratio <= 0.20
        ):
            return "high"

        if (
            text_length >= self.MIN_MEDIUM_TEXT_LENGTH
            and readable_ratio >= 0.45
            and garbled_ratio <= 0.35
        ):
            return "medium"

        return "low"
