// Keep trigger bodies together while executing multi-line migrations in D1 tests.
export async function applySql(db, sql) {
  const triggers = []
  const source = sql.replace(/CREATE TRIGGER\b[\s\S]*?\bEND;/g, (statement) => {
    triggers.push(statement)
    return `__TRIGGER_${triggers.length - 1}__;`
  })
  for (const statement of source.split(';').map(s=>s.trim()).filter(Boolean)) {
    const trigger = statement.match(/^__TRIGGER_(\d+)__$/)
    await db.prepare(trigger ? triggers[Number(trigger[1])] : statement).run()
  }
}
