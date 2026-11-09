import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user
from app.api.routes.creator_assets import require_story_editor
from app.core.security import AuthenticatedUser
from app.services.gemini import analyse_manuscript_structure, chat_about_manuscript

router = APIRouter()


class ManuscriptBlock(BaseModel):
    type: str = Field(pattern=r"^(paragraph|heading|quote|separator|spacer)$")
    text: str = Field(max_length=5000)


class ManuscriptAnalysisSubmission(BaseModel):
    story_title: str = Field(min_length=1, max_length=160)
    blocks: list[ManuscriptBlock] = Field(min_length=1, max_length=2000)
    author_instructions: str = Field(default="", max_length=4000)

    @field_validator("blocks")
    @classmethod
    def validate_total_size(cls, value: list[ManuscriptBlock]) -> list[ManuscriptBlock]:
        encoded = json.dumps([block.model_dump() for block in value], ensure_ascii=False).encode("utf-8")
        if len(encoded) > 1_500_000:
            raise ValueError("The manuscript text sent for AI analysis must be 1.5 MB or smaller.")
        if not any(block.text.strip() for block in value):
            raise ValueError("The manuscript does not contain readable text.")
        return value


@router.post("/creator/stories/{story_id}/manuscript/analyse")
async def analyse_creator_manuscript(
    story_id: UUID,
    submission: ManuscriptAnalysisSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)
    return await analyse_manuscript_structure(
        [block.model_dump() for block in submission.blocks],
        submission.story_title,
        submission.author_instructions,
    )


class ManuscriptChatMessage(BaseModel):
    role: str = Field(pattern=r"^(user|model)$")
    text: str = Field(min_length=1, max_length=2000)


class ManuscriptChatSubmission(BaseModel):
    story_title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    blocks: list[ManuscriptBlock] = Field(default_factory=list, max_length=2000)
    history: list[ManuscriptChatMessage] = Field(default_factory=list, max_length=10)

    @field_validator("blocks")
    @classmethod
    def validate_chat_context_size(cls, value: list[ManuscriptBlock]) -> list[ManuscriptBlock]:
        encoded = json.dumps([block.model_dump() for block in value], ensure_ascii=False).encode("utf-8")
        if len(encoded) > 1_500_000:
            raise ValueError("The manuscript context sent to Gemini must be 1.5 MB or smaller.")
        return value


@router.post("/creator/stories/{story_id}/manuscript/chat")
async def chat_with_creator_manuscript(
    story_id: UUID,
    submission: ManuscriptChatSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)
    return await chat_about_manuscript(
        submission.story_title,
        submission.message,
        [block.model_dump() for block in submission.blocks],
        [item.model_dump() for item in submission.history],
    )
