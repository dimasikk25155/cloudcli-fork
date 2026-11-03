import { authenticatedFetch } from '../../utils/api';
export async function workspaceApi<T>(path:string, options:RequestInit={}):Promise<T> {
 const response=await authenticatedFetch('/api/agent-workspace'+path,options);
 const data=await response.json();
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Не удалось выполнить действие');
 return data as T;
}
export function workspaceJson(method:string,body:unknown):RequestInit{return {method,body:JSON.stringify(body)};}
