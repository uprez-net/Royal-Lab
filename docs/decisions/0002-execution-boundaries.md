# Execution boundaries for issues #4–#10

Node 24 runs the common controller. AI SDK 7's `ToolLoopAgent` owns the candidate
loop; Royal-Lab controls the frozen prompt, tool schemas, serial execution,
prepare-step budget guards, explicit zero transport retries and saved evidence.
Gateway and direct OpenAI chat transports are lazy and take exact configured model
IDs/credentials. No model is chosen implicitly and no paid request is authorized
by installation or an offline check. Unsupported effective parameters are errors.

The document environment owns file capability boundaries. A pinned non-root,
network-disabled Docker worker owns binary parsing. The trusted controller owns
provider requests. The pinned Guri bridge owns canonical command imports and
disposable PostgreSQL state. Candidates cannot call shell, SQL or host network
tools, choose a checkout/database, or access grading/credentials.

Trace/result contracts add version 1.1 for request/response/question/termination
events and explicitly unknown token usage. Version 1.0 artifacts remain valid
under their original meanings; zero never replaces missing usage. Strict success
still requires every mandatory correctness criterion. Document execution is not
semantic grading, which remains issue #11.

The SDK callbacks are evidence hooks, not reliable stopping guards. Budget and
unknown-usage checks run in `prepareStep`, tool execution and final validation.
Pricing snapshots are explicit. The cost reservation covers the remaining declared
input/output token budget at uncached rates; an unaffordable configuration fails
before a request. Actual reported usage is also checked after each response.
Provider-internal accounting/context limits remain declared experimental limits.

Live paid validation waits for an explicit configuration, spend authorization and
approved task packs. Offline transport tests exercise both real SDK adapters with
mock HTTP responses, never a provider call or a model score. Integration tests
exercise actual Docker parsing and canonical commands on disposable PostgreSQL.
