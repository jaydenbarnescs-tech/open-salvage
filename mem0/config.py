"""
Shared Mem0 configuration for Vanessa memory scripts.
All scripts import get_memory() from here.

LLM:         Claude Haiku via mgc-pass-proxy (Claude Code Max plan auth, no billing needed)
Embedder:    qwen3-embedding:0.6b via local Ollama — 1024 dims, no external API
Vector store: FAISS persisted to ~/clawd/sessions/mem0-store/
"""
import os
from pathlib import Path
from mem0 import Memory


# ── Fix 1: Monkey-patch OllamaEmbedding to pass keep_alive=0 ─────────────────
# The upstream mem0 OllamaEmbedding.embed() does not pass keep_alive to the API,
# so qwen3-embedding:0.6b stays loaded in RAM indefinitely (1.28 GB resident).
# This subclass overrides embed() to always send keep_alive=0, which tells Ollama
# to unload the model immediately after each embedding request.
def _patch_ollama_embedder():
    try:
        from mem0.embeddings.ollama import OllamaEmbedding
        from mem0.configs.embeddings.base import BaseEmbedderConfig
        from typing import Literal, Optional

        class OllamaEmbeddingWithUnload(OllamaEmbedding):
            """Subclass that passes keep_alive=0 so Ollama unloads the model after each call."""

            def embed(self, text, memory_action: Optional[Literal["add", "search", "update"]] = None):
                # Use the raw HTTP API instead of the client library to pass keep_alive.
                # The ollama Python client's embed() doesn't expose keep_alive param.
                import json, urllib.request
                payload = {
                    "model": self.config.model,
                    "input": text,
                    "keep_alive": 0,
                }
                req = urllib.request.Request(
                    f"{self.config.ollama_base_url}/api/embed",
                    data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
                embeddings = data.get("embeddings") or []
                if not embeddings:
                    raise ValueError(
                        f"Ollama embed() returned no embeddings for model '{self.config.model}'"
                    )
                return embeddings[0]

        # Register the patched class back into the mem0 embeddings registry
        import mem0.embeddings.ollama as _ollama_mod
        _ollama_mod.OllamaEmbedding = OllamaEmbeddingWithUnload

        # Also patch the factory/registry if mem0 uses one
        try:
            import mem0.utils.factory as _factory
            if hasattr(_factory, 'EmbedderFactory'):
                _factory.EmbedderFactory._providers = {
                    k: (OllamaEmbeddingWithUnload if v is OllamaEmbedding else v)
                    for k, v in _factory.EmbedderFactory._providers.items()
                }
        except Exception:
            pass

        # Patch via embedder map if mem0 uses a string→class map
        try:
            from mem0.embeddings import base as _base
            if hasattr(_base, 'EmbedderBase'):
                pass  # no map here
        except Exception:
            pass

    except Exception as e:
        import sys
        sys.stderr.write(f"[config] WARNING: OllamaEmbedding monkey-patch failed: {e}\n")


_patch_ollama_embedder()

STORE_PATH   = str(Path.home() / "clawd/sessions/mem0-store")
AGENT_ID     = "vanessa"

# qwen3-embedding:0.6b via local Ollama → 1024 dims
EMBEDDING_DIMS  = 1024
EMBEDDING_MODEL = "qwen3-embedding:0.6b"
OLLAMA_BASE_URL = "http://localhost:11434"

# mgc-pass-proxy: Anthropic-compatible proxy backed by Claude Code Max plan auth.
MGC_PROXY_BASE_URL = "https://mgc-pass-proxy.duckdns.org"
MGC_PROXY_API_KEY  = "proxy"

# Custom extraction prompt: unlike Mem0's default (extracts personal facts about users),
# Vanessa stores operational memories — instructions, preferences, commitments, state.
# This prompt tells the LLM to preserve all such directives verbatim.
VANESSA_EXTRACTION_PROMPT = """\
You are Vanessa's memory manager. Your job is to extract and preserve important operational information.

Extract ALL of the following from the input:
1. Standing instructions (e.g. "always do X", "never do Y", "from now on...")
2. User preferences (e.g. communication style, language, format preferences)
3. Commitments and promises (e.g. "I will...", "remind me to...")
4. System state facts (e.g. status updates, configuration facts)

Rules:
- Preserve instructions VERBATIM — do not paraphrase or shorten
- If the entire input IS an instruction/preference, return it as a single fact
- Return each fact as a separate item
- If nothing extractable is present, return empty list

Return JSON: {"facts": ["fact1", "fact2", ...]}

Today's date: {current_date}

Input:
"""


def get_memory() -> Memory:
    """Return a configured Mem0 Memory instance backed by FAISS on disk."""

    # Point the Anthropic SDK at the mgc-proxy so Mem0's internal LLM calls
    # route through Claude Code's Max plan auth instead of a direct API key.
    os.environ["ANTHROPIC_BASE_URL"] = MGC_PROXY_BASE_URL
    os.environ["ANTHROPIC_API_KEY"]  = MGC_PROXY_API_KEY

    from datetime import date
    extraction_prompt = VANESSA_EXTRACTION_PROMPT.replace(
        "{current_date}", date.today().isoformat()
    )

    config = {
        "llm": {
            "provider": "anthropic",
            "config": {
                "model": "claude-haiku-4-5-20251001",
                "api_key": MGC_PROXY_API_KEY,
                "temperature": 0.0,
                "max_tokens": 2000,
            },
        },
        "embedder": {
            "provider": "ollama",
            "config": {
                "model": EMBEDDING_MODEL,
                "ollama_base_url": OLLAMA_BASE_URL,
                "embedding_dims": EMBEDDING_DIMS,
                # keep_alive is handled by the OllamaEmbeddingWithUnload monkey-patch
                # (BaseEmbedderConfig does not accept keep_alive as a kwarg)
            },
        },
        "vector_store": {
            "provider": "faiss",
            "config": {
                "collection_name": "vanessa",
                "path": STORE_PATH,
                "embedding_model_dims": EMBEDDING_DIMS,
            },
        },
        "custom_fact_extraction_prompt": extraction_prompt,
    }

    return Memory.from_config(config)
