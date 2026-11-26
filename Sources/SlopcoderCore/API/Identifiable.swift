import Foundation

// Rows a list can key on: every record the server gives an id of its own.
extension SessionSummary: Identifiable {}
extension AttachedNode: Identifiable {}
extension SubSessionInfo: Identifiable {}
extension SessionState: Identifiable {}
extension RemoteNodeSummary: Identifiable {}
extension AutomationTrigger: Identifiable {}
extension AutomationSummary: Identifiable {}
extension RunSummary: Identifiable {}
extension RoutineCard: Identifiable {}
extension HeartbeatStatus: Identifiable {}
extension ChannelSummary: Identifiable {}
extension ConnectionSummary: Identifiable {}
extension ModelOption: Identifiable {}
extension GitConnectionSummary: Identifiable {}
extension GitAppSummary: Identifiable {}
extension McpServerSummary: Identifiable {}
extension UserFacetSummary: Identifiable {}
extension ArtifactSummary: Identifiable {}
extension MemorySummary: Identifiable {}
extension UserSkillSummary: Identifiable {}
extension ApiKeySummary: Identifiable {}
extension CodeReviewListItem: Identifiable {}
extension CodeReviewDetail: Identifiable {}
extension CodeReviewFindingBrief: Identifiable {}
extension CodeReviewFindingSummary: Identifiable {}
extension CodeReviewPublicationView: Identifiable {}
