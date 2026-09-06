import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { studioLoginSchema, studioPasswordSchema } from "../../src/shared/studio-contracts";
import { PasswordPage } from "../../src/features/studio/pages/PasswordPage";

afterEach(() => vi.restoreAllMocks());

it.each([1, 201, 1024])("accepts %i characters in every password validation field", (length) => {
  const password = "x".repeat(length);
  expect(studioLoginSchema.parse({ username: "zd", password }).password).toBe(password);
  expect(studioPasswordSchema.parse({ currentPassword: "old", newPassword: password }).newPassword).toBe(password);
  expect(studioPasswordSchema.parse({ currentPassword: password, newPassword: "new" }).currentPassword).toBe(password);
});

it.each([0, 1025])("rejects %i characters in every password validation field", (length) => {
  const password = "x".repeat(length);
  expect(studioLoginSchema.safeParse({ username: "zd", password }).success).toBe(false);
  expect(studioPasswordSchema.safeParse({ currentPassword: "old", newPassword: password }).success).toBe(false);
  expect(studioPasswordSchema.safeParse({ currentPassword: password, newPassword: "new" }).success).toBe(false);
});

it("preserves password whitespace without introducing normalization or changing equality checks", () => {
  expect(studioLoginSchema.parse({ username: "zd", password: " x " }).password).toBe(" x ");
  expect(studioPasswordSchema.parse({ currentPassword: "old", newPassword: " " }).newPassword).toBe(" ");
  expect(studioPasswordSchema.safeParse({ currentPassword: "x", newPassword: "x" }).success).toBe(false);
});

it("submits a one-character password from Studio without the old HTML length restrictions", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  render(<MemoryRouter initialEntries={["/studio/password"]}><Routes>
    <Route element={<Outlet context={{ liveMode: false }} />}>
      <Route path="/studio/password" element={<PasswordPage />} />
    </Route>
    <Route path="/studio/login" element={<p>密码修改完成</p>} />
  </Routes></MemoryRouter>);
  for (const [label, value] of [["当前密码", "old"], ["新密码", "x"], ["确认新密码", "x"]]) {
    const input = screen.getByLabelText(label!);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxlength", "1024");
    expect(input).not.toHaveAttribute("minlength");
    fireEvent.change(input, { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "保存新密码" }));
  await waitFor(() => expect(screen.getByText("密码修改完成")).toBeInTheDocument());
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ currentPassword: "old", newPassword: "x" });
});
