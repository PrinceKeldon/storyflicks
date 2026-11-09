import MaterialReadingRoom from "./material-reading-room";
export default async function MaterialPage({params}:{params:Promise<{slug:string;materialId:string}>}){
 const {slug,materialId}=await params;
 return <MaterialReadingRoom slug={slug} materialId={materialId}/>;
}
