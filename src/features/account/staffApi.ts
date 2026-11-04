import { accountRequest } from './accountApi'
export type Staff = { photo_url:string; id:string; name:string; is_active:number; email:string|null; has_access:number }
export async function getStaff():Promise<Staff[]> { return (await accountRequest<{staff:Staff[]}>('staff')).staff }
