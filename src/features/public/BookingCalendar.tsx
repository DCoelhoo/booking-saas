import { useState } from 'react'
import './BookingCalendar.css'

const parse = (value:string) => new Date(value + 'T12:00:00Z')
const iso = (date:Date) => date.toISOString().slice(0,10)
const label = (value:string) => new Intl.DateTimeFormat('pt-PT',{dateStyle:'full',timeZone:'UTC'}).format(parse(value))
const monthLabel = new Intl.DateTimeFormat('pt-PT',{month:'long',year:'numeric',timeZone:'UTC'})

export default function BookingCalendar({value,min,max,disabled,onChange}:{value:string;min:string;max:string;disabled:boolean;onChange:(value:string)=>void}) {
  const [month,setMonth]=useState(()=>value.slice(0,7))
  const first=parse(month+'-01')
  const offset=(first.getUTCDay()+6)%7
  const count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate()
  const changeMonth=(amount:number)=>setMonth(iso(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+amount,1))).slice(0,7))
  return <section className="booking-calendar" aria-label="Escolher o dia da marcação">
    <div className="booking-calendar-heading"><button type="button" aria-label="Mês anterior" disabled={disabled || month<=min.slice(0,7)} onClick={()=>changeMonth(-1)}>‹</button>
      <h3 aria-live="polite">{monthLabel.format(first)}</h3>
      <button type="button" aria-label="Mês seguinte" disabled={disabled || month>=max.slice(0,7)} onClick={()=>changeMonth(1)}>›</button></div>
    <div className="booking-calendar-week" aria-hidden="true">{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(day=><span key={day}>{day}</span>)}</div>
    <div className="booking-calendar-days">{Array.from({length:offset},(_,i)=><span key={'empty'+i} />)}{Array.from({length:count},(_,i)=>{
      const date=month+'-'+String(i+1).padStart(2,'0')
      return <button type="button" key={date} aria-label={label(date)} aria-pressed={date===value} aria-current={date===min?'date':undefined} disabled={disabled || date<min || date>max} onClick={()=>onChange(date)}>{i+1}{date===min && <span className="booking-calendar-today" aria-hidden="true" />}</button>
    })}</div>
    <div className="booking-calendar-selected" role="status">{label(value)}</div>
  </section>
}
