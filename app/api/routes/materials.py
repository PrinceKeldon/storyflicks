from typing import Any, Literal
from datetime import datetime, timezone
from uuid import UUID
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router=APIRouter()
SectionType=Literal["dedication","foreword","preface","author_note","prologue","epilogue","afterword","acknowledgements","about_author","further_reading","other"]
Placement=Literal["front_matter","back_matter"]

class MaterialSubmission(BaseModel):
 title:str=Field(min_length=1,max_length=200)
 section_type:SectionType="other"
 placement:Placement
 position:int=Field(default=0,ge=0,le=10000)
 content:Any=Field(default_factory=list)
 publication_status:Literal["draft","published"]="draft"
 is_visible:bool=True
 @field_validator("title")
 @classmethod
 def nonblank(cls,v):
  if not v.strip(): raise ValueError("A section title is required.")
  return v.strip()
 @field_validator("content")
 @classmethod
 def bounded_content(cls,v):
  try: size=len(json.dumps(v,ensure_ascii=False,separators=(",",":")).encode())
  except (TypeError,ValueError): raise ValueError("Content must be valid JSON.")
  if size>2*1024*1024: raise ValueError("A section cannot exceed 2 MB.")
  if not isinstance(v,(list,dict)): raise ValueError("Content must be a list of manuscript blocks.")
  return v

async def editor_access(story_id:UUID,user:AuthenticatedUser):
 p=await supabase.admin_get("creator_profiles",{"id":f"eq.{user.id}","status":"eq.active","limit":"1"})
 a=await supabase.admin_get("story_creators",{"story_id":f"eq.{story_id}","creator_id":f"eq.{user.id}","role":"in.(owner,author,editor)","limit":"1"})
 if not p or not a: raise HTTPException(403,"You do not have permission to manage this story.")

@router.get("/creator/stories/{story_id}/materials")
async def list_materials(story_id:UUID,user:AuthenticatedUser=Depends(get_current_user)):
 await editor_access(story_id,user)
 rows=await supabase.admin_get("story_material_sections",{"select":"id,story_id,title,section_type,placement,position,content,publication_status,is_visible,created_at,updated_at","story_id":f"eq.{story_id}","deleted_at":"is.null","order":"placement.asc,position.asc,created_at.asc","limit":"200"})
 return {"materials":rows}

@router.post("/creator/stories/{story_id}/materials")
async def create_material(story_id:UUID,body:MaterialSubmission,user:AuthenticatedUser=Depends(get_current_user)):
 await editor_access(story_id,user)
 await supabase.admin_insert("story_material_sections",{"story_id":str(story_id),"title":body.title,"section_type":body.section_type,"placement":body.placement,"position":body.position,"content":body.content,"publication_status":body.publication_status,"is_visible":body.is_visible,"created_by":str(user.id)})
 rows=await supabase.admin_get("story_material_sections",{"select":"id,story_id,title,section_type,placement,position,content,publication_status,is_visible,created_at,updated_at","story_id":f"eq.{story_id}","order":"created_at.desc","limit":"1"})
 if not rows: raise HTTPException(500,"Section saved but could not be reloaded.")
 return rows[0]

@router.put("/creator/stories/{story_id}/materials/{material_id}")
async def update_material(story_id:UUID,material_id:UUID,body:MaterialSubmission,user:AuthenticatedUser=Depends(get_current_user)):
 await editor_access(story_id,user)
 found=await supabase.admin_get("story_material_sections",{"select":"id","id":f"eq.{material_id}","story_id":f"eq.{story_id}","deleted_at":"is.null","limit":"1"})
 if not found: raise HTTPException(404,"Story material section not found.")
 await supabase.admin_patch("story_material_sections",{"id":f"eq.{material_id}","story_id":f"eq.{story_id}"},{"title":body.title,"section_type":body.section_type,"placement":body.placement,"position":body.position,"content":body.content,"publication_status":body.publication_status,"is_visible":body.is_visible,"updated_at":datetime.now(timezone.utc).isoformat()})
 rows=await supabase.admin_get("story_material_sections",{"select":"id,story_id,title,section_type,placement,position,content,publication_status,is_visible,created_at,updated_at","id":f"eq.{material_id}","limit":"1"})
 return rows[0] if rows else {"id":str(material_id)}

@router.post("/creator/stories/{story_id}/materials/{material_id}/hide")
async def hide_material(story_id:UUID,material_id:UUID,user:AuthenticatedUser=Depends(get_current_user)):
 await editor_access(story_id,user)
 found=await supabase.admin_get("story_material_sections",{"select":"id","id":f"eq.{material_id}","story_id":f"eq.{story_id}","limit":"1"})
 if not found: raise HTTPException(404,"Story material section not found.")
 await supabase.admin_patch("story_material_sections",{"id":f"eq.{material_id}","story_id":f"eq.{story_id}"},{"is_visible":False,"publication_status":"draft"})
 return {"id":str(material_id),"hidden":True}

@router.post("/creator/stories/{story_id}/materials/{material_id}/restore")
async def restore_material(story_id:UUID,material_id:UUID,user:AuthenticatedUser=Depends(get_current_user)):
 await editor_access(story_id,user)
 found=await supabase.admin_get("story_material_sections",{"select":"id","id":f"eq.{material_id}","story_id":f"eq.{story_id}","limit":"1"})
 if not found: raise HTTPException(404,"Story material section not found.")
 await supabase.admin_patch("story_material_sections",{"id":f"eq.{material_id}","story_id":f"eq.{story_id}"},{"is_visible":True,"publication_status":"draft","updated_at":datetime.now(timezone.utc).isoformat()})
 return {"id":str(material_id),"restored":True,"publication_status":"draft","is_visible":True}

@router.get("/stories/{slug}/materials/{material_id}")
async def read_material(slug:str,material_id:UUID):
 stories=await supabase.admin_get("stories",{"select":"id,slug,title,publication_status","slug":f"eq.{slug}","publication_status":"eq.published","limit":"1"})
 if not stories: raise HTTPException(404,"Story not found.")
 rows=await supabase.admin_get("story_material_sections",{"select":"id,title,section_type,placement,content","id":f"eq.{material_id}","story_id":f"eq.{stories[0]['id']}","publication_status":"eq.published","is_visible":"eq.true","deleted_at":"is.null","limit":"1"})
 if not rows: raise HTTPException(404,"Story material not found.")
 return {"story":stories[0],"material":rows[0]}
