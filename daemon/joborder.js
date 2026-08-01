// A scheduled job is a REAL order, not a reminder.
//
// The owner set a standing work order, it fired on time, the Director replied
// "ok, here's the plan" — and the office went quiet. Nothing was dispatched, and
// the owner had to come back and give the same order by hand. That defeats the
// entire point of scheduling.
//
// Why it happened: every other run path in the office wraps the prompt with the
// context that makes work actually move — the Director's DELEGATE protocol, and
// (when 🤖 AUTO is on) the keep-going STATUS contract. The job runner was the one
// path that sent the raw prompt with none of it, and read the reply with no
// DELEGATE parser attached. So a `DELEGATE:` line written by a scheduled Director
// turn was printed as prose and thrown away.
//
// This module holds the text side of the fix so it can be tested without booting
// a daemon. Two rules:
//   1. A job carries the standing-order note — act in THIS turn, don't acknowledge.
//   2. A job on the Director carries the full DELEGATE protocol, exactly like an
//      order typed by the owner. Anyone else must not be told to delegate: only
//      the Director's replies are parsed for DELEGATE lines, so a teammate writing
//      one would just be talking to itself.
const DIRECTOR = "main";

const JOB_NOTE = `

<standing-order>
นี่คือ "งานที่ตั้งเวลาไว้" ที่ถึงกำหนดแล้ว ระบบเป็นคนเปิดเทิร์นนี้ให้ — ไม่ใช่เจ้าของเพิ่งพิมพ์คุยกับคุณสดๆ.
เจ้าของอาจไม่ได้อยู่หน้าจอตอนนี้ และจะไม่มีใครมาตอบคำถามระหว่างทาง. เพราะฉะนั้น "ลงมือทำจริงในเทิร์นนี้"
— ไม่ใช่ตอบรับว่าจะทำ ไม่ใช่บอกแผนแล้วจบ. รายละเอียดที่อยู่ในขอบเขตของคุณให้ตัดสินใจเองแล้วเดินหน้าต่อ
จนเสร็จจริงและ verify แล้ว. หยุดเพื่อรอเจ้าของเฉพาะเมื่อขาด credential/สิทธิ์ที่หาเองไม่ได้ หรือเมื่อ
ต้องทำสิ่งที่ย้อนกลับยาก/ส่งออกนอก (push, deploy, ลบของ, ส่งข้อความออกภายนอก, ใช้จ่ายเงิน) เท่านั้น.
In short: a scheduled order is a real order — do the work now, don't just acknowledge it.
</standing-order>`;

const JOB_DIRECTOR_NOTE = `

<standing-order-director>
งานตั้งเวลานี้มาถึงคุณในฐานะ Director: ถ้าเนื้องานเป็นของทีม คุณต้องส่งออกไปด้วยบรรทัด DELEGATE: จริงๆ
ในคำตอบนี้เลย — เขียนบรรยายว่า "จะให้ใครทำอะไร" ไม่มีใครได้รับงาน และงานจะค้างอยู่เฉยๆ จนเจ้าของกลับมา.
</standing-order-director>`;

/** Only the Director's replies are parsed for DELEGATE lines. */
const isDirectorJob = (agent) => agent === DIRECTOR;

/**
 * The prompt a fired job should actually run with.
 * `directorNote` / `autoNote` are passed in (they're built from live registry
 * state) so this stays pure and testable.
 */
function jobPrompt(prompt, { director = false, directorNote = "", autoNote = "" } = {}) {
  return String(prompt) + JOB_NOTE +
    (director ? JOB_DIRECTOR_NOTE + directorNote : "") + autoNote;
}

module.exports = { JOB_NOTE, JOB_DIRECTOR_NOTE, jobPrompt, isDirectorJob, DIRECTOR };
