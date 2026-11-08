from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "STORYFLICKS API"
    app_env: str = "development"
    api_v1_prefix: str = "/api"
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    scheduler_secret: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    frontend_base_url: str = "http://localhost:3000"
    story_assets_bucket: str = "story-assets"
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def supabase_rest_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/rest/v1"

    @property
    def supabase_auth_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
