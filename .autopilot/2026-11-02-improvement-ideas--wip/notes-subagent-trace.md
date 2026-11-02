# Codex helper trace, 2026-11-02
Read-only evidence from sessions DB and exact parent rollout; no prompts copied.
Neo3 session 0de6aa54-7dff-4ed2-ba1e-1cdb723a67a9 -> Codex 01a19a08-2d18-7063-8982-be8faf3ea931.
Rollout: /Users/dimasik/.codex/sessions/2026/11/02/rollout-2026-11-02T05-13-09-01a19a08-2d18-7063-8982-be8faf3ea931.jsonl.

## Confirmed persisted shapes
- response_item/function_call name=spawn_agent, arguments has task_name, message, fork_turns, optional agent_type; call_id=C.
- function_call_output call_id=C, output JSON {"task_name":"/root/helper"}; no agent_id.
- event_msg payload.type=item_completed, payload.item={type:"SubAgentActivity",id:C,kind:"started",agent_thread_id:T,agent_path:"/root/helper",model:"gpt-6-astra",reasoning_effort:"medium"}.
- Terminal activity same thread/path, kind:"completed", id:"subagent-completed-<opaque>"; id is NOT original spawn call id. Actual lines: 671 started /root/file_link_decode, 759 completed; 780 started /root/link_decode_review, 803 completed.
- response_item payload.type=agent_message, id:amsg_..., author:"/root/helper",recipient:"/root",content:[{type:"input_text",text:"Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/helper\nPayload: <summary>"}]. Final messages are plain text and really persisted. 27 agent_message records observed; non-final MESSAGE records often have encrypted_content alongside visible header (do not decrypt).
- wait_agent output {message:"Wait completed.",timed_out:false} or timeout true; no child status map. Wait success is NOT completion proof.
- followup_task yields an interacted SubAgentActivity for same agent_thread_id/path, then another terminal completed and another FINAL_ANSWER. send_message also yields interacted, so interacted alone cannot distinguish a new job. Match calls by tools and task path, not all interacted events.

## Current loss points
getCodexSessionMessages in codex-sessions.provider.ts ignores response_item agent_message AND event_msg item_completed/SubAgentActivity; normalizeHistoryEntry has no passthrough for these. codexSubagentHistory only maps spawn output.agent_id and wait output.status.
Live openai-codex.js only forwards event.item.type=collab_tool_call to tracker. It otherwise maps agent_message to main assistant text and ignores unknown subagent item types. SDK runStreamedInternal simply JSON.parse/yield; native stdout shape is NOT established by transcript evidence. Support persisted Pascal form and observed CLI snake counterpart only after validation; do not claim live capture was obtained here.

## Narrow fix surfaces
codex-subagents.ts tracker/history; codex-sessions.provider.ts ingestion + normalization; openai-codex.js live routing; tests codex-subagents and provider history fixture; frontend normalizedToChatMessages task_notification/Crab tests. Preserve existing dirty audit changes in provider files. Replay this parent history read-only for acceptance counts; never edit original JSONL/DB.
