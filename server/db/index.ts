export type {
  RoomRow,
  CreateRoomInput,
  AgentRow,
  CreateAgentInput,
  OrgRoleRow,
  OrganizationRow,
  OrganizationMemberRow,
  OrganizationInviteRow,
} from "./sqlite.js";

const url = process.env.DATABASE_URL ?? "";
const usePostgres = url.startsWith("postgres");

const backend = usePostgres
  ? await import("./postgres.js")
  : await import("./sqlite.js");

export const createRoom = backend.createRoom;
export const listRooms = backend.listRooms;
export const getRoom = backend.getRoom;
export const updateRoomActivity = backend.updateRoomActivity;
export const updateRoomStatus = backend.updateRoomStatus;
export const setCursorSessionId = backend.setCursorSessionId;
export const setCursorAgentId = backend.setCursorAgentId;
export const setPrUrl = backend.setPrUrl;
export const setModelId = backend.setModelId;
export const setRoomByokKey = backend.setRoomByokKey;
export const insertSteerMessage = backend.insertSteerMessage;
export const getSteerHistory = backend.getSteerHistory;
export const insertMessage = backend.insertMessage;
export const updateMessageContent = backend.updateMessageContent;
export const updateMessageDiff = backend.updateMessageDiff;
export const updateMessageTool = backend.updateMessageTool;
export const getMessages = backend.getMessages;
export const deleteRoom = backend.deleteRoom;
export const getSetting = backend.getSetting;
export const setSetting = backend.setSetting;
export const deleteSetting = backend.deleteSetting;

// Auth
export const createUser = backend.createUser;
export const upsertUser = backend.upsertUser;
export const getUserByEmail = backend.getUserByEmail;
export const getUserById = backend.getUserById;
export const createSession = backend.createSession;
export const getSession = backend.getSession;
export const deleteSession = backend.deleteSession;
export const deleteExpiredSessions = backend.deleteExpiredSessions;
export const createPairingCode = backend.createPairingCode;
export const getPairingCode = backend.getPairingCode;
export const usePairingCode = backend.usePairingCode;
export const setRoomOwner = backend.setRoomOwner;
export const setRoomControlMode = backend.setRoomControlMode;
export const addRoomMember = backend.addRoomMember;
export const removeRoomMember = backend.removeRoomMember;
export const getRoomMembers = backend.getRoomMembers;
export const getRoomMemberRole = backend.getRoomMemberRole;
export const isRoomMember = backend.isRoomMember;
export const getModelCache = backend.getModelCache;
export const setModelCache = backend.setModelCache;
export const createInviteLink = backend.createInviteLink;
export const getInviteLink = backend.getInviteLink;
export const listInviteLinks = backend.listInviteLinks;
export const deleteInviteLink = backend.deleteInviteLink;
export const useInviteLink = backend.useInviteLink;
export const registerWorker = backend.registerWorker;
export const updateWorkerStatus = backend.updateWorkerStatus;
export const getOnlineWorkers = backend.getOnlineWorkers;
export const listRoomsByUser = backend.listRoomsByUser;
export const listPersonalRoomsByUser = backend.listPersonalRoomsByUser;
export const listRoomsByOrg = backend.listRoomsByOrg;

// Organizations
export const createOrganization = backend.createOrganization;
export const getOrganization = backend.getOrganization;
export const getOrganizationBySlug = backend.getOrganizationBySlug;
export const updateOrganization = backend.updateOrganization;
export const deleteOrganization = backend.deleteOrganization;
export const listOrganizationsForUser = backend.listOrganizationsForUser;
export const listOrganizationsWithDomains = backend.listOrganizationsWithDomains;
export const addOrganizationMember = backend.addOrganizationMember;
export const getOrganizationMember = backend.getOrganizationMember;
export const listOrganizationMembers = backend.listOrganizationMembers;
export const countOrganizationMembers = backend.countOrganizationMembers;
export const updateOrganizationMemberRole = backend.updateOrganizationMemberRole;
export const removeOrganizationMember = backend.removeOrganizationMember;
export const createOrganizationInvite = backend.createOrganizationInvite;
export const getOrganizationInvite = backend.getOrganizationInvite;
export const listOrganizationInvites = backend.listOrganizationInvites;
export const deleteOrganizationInvite = backend.deleteOrganizationInvite;
export const useOrganizationInvite = backend.useOrganizationInvite;
export const isOrganizationMember = backend.isOrganizationMember;

// Agents
export const createAgent = backend.createAgent;
export const getAgent = backend.getAgent;
export const listAgents = backend.listAgents;
export const updateAgentStatus = backend.updateAgentStatus;
export const setAgentSessionId = backend.setAgentSessionId;
export const setAgentSdkId = backend.setAgentSdkId;
export const setAgentModel = backend.setAgentModel;
export const setAgentLabel = backend.setAgentLabel;
export const setAgentScope = backend.setAgentScope;
export const setAgentPr = backend.setAgentPr;
export const deleteAgent = backend.deleteAgent;
export const setAgentDriver = backend.setAgentDriver;
export const clearAgentDriver = backend.clearAgentDriver;
export const getAgentDrivers = backend.getAgentDrivers;
export const migrateAgentsV1 = backend.migrateAgentsV1;

// File locks
export const upsertFileLock = backend.upsertFileLock;
export const getFileLock = backend.getFileLock;
export const listFileLocks = backend.listFileLocks;
export const listAllFileLocks = backend.listAllFileLocks;
export const deleteFileLock = backend.deleteFileLock;
export const deleteFileLocksForAgent = backend.deleteFileLocksForAgent;
export const deleteFileLocksForRoom = backend.deleteFileLocksForRoom;
export const deleteExpiredFileLocks = backend.deleteExpiredFileLocks;
export const deleteExpiredFileLocksForRoom =
  backend.deleteExpiredFileLocksForRoom;
