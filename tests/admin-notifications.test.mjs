import test from "node:test";
import assert from "node:assert/strict";

import {
  WORK_HOURS_NOTIFICATION_TYPE,
  unreadWorkHoursNotifications,
  workHoursNotificationId
} from "../src/lib/admin-notifications.js";

test("선생님과 급여월마다 수업시간 알림 ID를 하나만 만든다", () => {
  assert.equal(
    workHoursNotificationId("2026-08", "teacher-1"),
    "work-hours_2026-08_teacher-1"
  );
});

test("관리자 알림 개수에는 읽지 않은 수업시간 제출만 포함한다", () => {
  const notifications = [
    { type: WORK_HOURS_NOTIFICATION_TYPE, status: "unread" },
    { type: WORK_HOURS_NOTIFICATION_TYPE, status: "read" },
    { type: "other", status: "unread" }
  ];
  assert.equal(unreadWorkHoursNotifications(notifications).length, 1);
});
