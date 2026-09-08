export function linkedTeacherForUser(user, teachers, { activeOnly = false } = {}) {
  if (!user?.uid || !user.teacherId || user.status !== "active") return null;
  return teachers.find((teacher) => teacher.id === user.teacherId
    && teacher.authUid === user.uid
    && (!activeOnly || teacher.status === "active")) || null;
}

export function assertTeacherAccountLink(account, teacher, uid) {
  if (!uid || (teacher.authUid && teacher.authUid !== uid)
    || (account?.teacherId && account.teacherId !== teacher.id)) {
    throw new Error("이미 다른 선생님 정보와 연결된 계정입니다. 새로고침 후 연결 상태를 확인해 주세요.");
  }
  if (account && !["admin", "teacher"].includes(account.role)) {
    throw new Error("계정 권한을 확인할 수 없습니다.");
  }
}

export function teacherAccountUpdate(account, teacher, uid) {
  assertTeacherAccountLink(account, teacher, uid);
  // Payroll status is independent of an administrator's login and permissions.
  if (account?.role === "admin") return { teacherId: teacher.id };
  return {
    displayName: teacher.name,
    email: teacher.email,
    role: "teacher",
    status: teacher.status,
    teacherId: teacher.id
  };
}
