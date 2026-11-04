import { useState } from 'react'
import './ProfilePhoto.css'

export default function Avatar({ name, src, size = 'small' }: { name:string; src?:string; size?:'small'|'large' }) {
  const [failed,setFailed] = useState('')
  const initials = name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase() || '?'
  return <span className={`profile-avatar profile-avatar-${size}`}>
    {src && failed !== src ? <img src={src} alt={`Fotografia de ${name}`} loading="lazy" onError={()=>setFailed(src)} /> : <span aria-label={name}>{initials}</span>}
  </span>
}
