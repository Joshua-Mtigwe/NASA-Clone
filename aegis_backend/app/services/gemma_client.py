"""Talks to a Gemma model served on this machine by Ollama (standard library only).

Ollama keeps the model on disk and answers on http://127.0.0.1:11434, so nothing here needs the
internet once the model has been pulled. By default the client refuses any address that is not
this machine: crew health data must not leave it. AEGIS_GEMMA_ALLOW_REMOTE=true lifts that.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.core.config import get_settings

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ModelUnavailable(Exception):
    """The model could not be reached or did not answer. `code` goes into ai_inference_logs.error_code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class OllamaClient:
    def __init__(self, url: str | None = None, model: str | None = None, timeout: float | None = None):
        settings = get_settings()
        self.url = (url or settings.gemma_url).rstrip("/")
        self.model = model or settings.gemma_model
        self.timeout = timeout or settings.gemma_timeout_seconds
        self.allow_remote = settings.gemma_allow_remote

    def _check_local(self) -> None:
        host = urllib.parse.urlparse(self.url).hostname or ""
        if host not in LOCAL_HOSTS and not self.allow_remote:
            raise ModelUnavailable("remote_host_refused",
                                   f"{host} is not this machine. Crew data is only sent to a local model.")

    def _request(self, path: str, payload: dict[str, Any] | None = None, timeout: float | None = None) -> dict:
        self._check_local()
        request = urllib.request.Request(
            self.url + path, data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers={"Content-Type": "application/json"}, method="POST" if payload is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            code = "model_not_installed" if exc.code == 404 else "model_http_error"
            raise ModelUnavailable(code, f"The model server answered {exc.code}") from exc
        except TimeoutError as exc:
            raise ModelUnavailable("model_timeout", f"No answer within {self.timeout:.0f} seconds") from exc
        except (urllib.error.URLError, OSError) as exc:
            if "timed out" in str(exc).lower():
                raise ModelUnavailable("model_timeout", f"No answer within {self.timeout:.0f} seconds") from exc
            raise ModelUnavailable("model_unreachable", f"Cannot reach the model server at {self.url}") from exc
        except ValueError as exc:
            raise ModelUnavailable("model_bad_response", "The model server sent something that is not JSON") from exc

    def generate(self, system: str, prompt: str, max_tokens: int = 400) -> str:
        """One answer, not streamed. Low temperature: these are factual summaries, not creative writing."""
        data = self._request("/api/generate", {
            "model": self.model, "system": system, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.2, "num_predict": max_tokens}})
        text = (data.get("response") or "").strip()
        if not text:
            raise ModelUnavailable("model_empty_response", "The model returned no text")
        return text

    def status(self) -> dict[str, Any]:
        """Is the server up, and is the configured model installed? Never raises."""
        out: dict[str, Any] = {"url": self.url, "model": self.model, "reachable": False, "model_installed": False,
                               "model_version": None, "installed_models": [], "error": None}
        try:
            tags = self._request("/api/tags", timeout=min(self.timeout, 5.0))
        except ModelUnavailable as exc:
            out["error"] = exc.message
            return out
        out["reachable"] = True
        for m in tags.get("models") or []:
            name = m.get("name") or m.get("model") or ""
            out["installed_models"].append(name)
            if name == self.model or name == f"{self.model}:latest":
                out["model_installed"] = True
                out["model_version"] = (m.get("digest") or "")[:12] or None
        return out


def get_client() -> OllamaClient:
    """The client the AI service uses. Tests replace this function with a fake."""
    return OllamaClient()
