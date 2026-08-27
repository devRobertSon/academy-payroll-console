export const WORK_HOURS_NOTIFICATION_TYPE = "teacher_monthly_input_submitted";

export function workHoursNotificationId(month, teacherId) {
  return `work-hours_${month}_${teacherId}`;
}

export function unreadWorkHoursNotifications(notifications = []) {
  return notifications.filter((notification) => (
    notification?.type === WORK_HOURS_NOTIFICATION_TYPE
    && notification?.status === "unread"
  ));
}

export function unreadAdminNotifications(notifications = [], supportedTypes = []) {
  const types = new Set(supportedTypes);
  return notifications.filter((notification) => (
    notification?.status === "unread"
    && types.has(notification?.type)
  ));
}
