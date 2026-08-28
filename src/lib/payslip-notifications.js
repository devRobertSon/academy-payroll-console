export const PORTAL_NOTICE_CHANNEL = "gmail_portal_notice";

export function pendingPortalNoticeTeachers(payrolls = [], deliveries = [], month, revision) {
  const deliveredTeacherIds = new Set(deliveries
    .filter((delivery) => (
      delivery?.channel === PORTAL_NOTICE_CHANNEL
      && delivery?.month === month
      && Number(delivery?.revision) === Number(revision)
    ))
    .map((delivery) => delivery.teacherId));

  return payrolls
    .map((item) => item?.teacher)
    .filter((teacher) => (
      teacher?.id
      && isEmail(teacher.email)
      && !deliveredTeacherIds.has(teacher.id)
    ));
}

export function portalNoticeDeliveryId(month, teacherId, revision) {
  return `portal-notice_${month}_${teacherId}_v${revision}`;
}

function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || ""));
}
