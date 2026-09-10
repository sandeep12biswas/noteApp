// electron-trpc router — DESIGN.md §3.2/§8.1/§8.2. Every procedure here is a
// thin pass-through to the Rust sidecar over the SidecarSupervisor; the
// procedure name is the wire-protocol `method` name from
// crates/flownote-electron/src/protocol.rs. Procedures for methods the
// sidecar doesn't implement yet reject with "method not implemented: <name>"
// (see protocol.rs's default match arm) — that's the same behavior
// packages/ipc-adapter's stub adapters already give the frontend, so
// wiring a new IPCAdapter method through end-to-end is just: implement it
// in protocol.rs, then flip its ElectronIPCAdapter method from a stub throw
// to a real trpc call.
import { initTRPC } from '@trpc/server'
import type { SidecarSupervisor } from '../sidecarSupervisor'

export interface Context {
  sidecar: SidecarSupervisor
}

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
  ping: t.procedure.query(({ ctx }) => ctx.sidecar.request('ping')),

  getPage: t.procedure
    .input((pageId: unknown): string => {
      if (typeof pageId !== 'string') throw new Error('getPage expects a string pageId')
      return pageId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('get_page', { pageId: input })),
})

export type AppRouter = typeof appRouter
