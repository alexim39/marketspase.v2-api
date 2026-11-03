import {TeamModel} from '../models/teams.model.js';
import {PartnersModel} from '../../partner/models/partner.model.js';
import { MongoGroupStore } from '../../../modules/messaging/infrastructure/Group.mongo.repository.js';

/**
 * Owner labels for team reads — safe fields only. partnerId stays a raw
 * id on every row; `owner` is purely additive so existing comparisons
 * and payloads keep working. Takes plain objects (lean/toObject).
 */
const sessionId = (req) => (req.auth?.partnerId ? String(req.auth.partnerId) : null);
const deny = (res, status, message) => res.status(status).json({ message, success: false });
/** Team read scope: creator, listed member, or admin. */
const canReadTeam = async (team, requester) => {
  if (!requester) return false;
  if (String(team.partnerId) === String(requester)) return true;
  if ((team.members ?? []).map(String).includes(String(requester))) return true;
  try {
    const { PartnersModel: PM } = await import('../../partner/models/partner.model.js');
    const me = await PM.findById(requester).select('role email').lean().catch(() => null);
    const { lenientRole, adminBootstrapEmails } = await import('../../../modules/identity-access/domain/PartnerRole.js');
    return lenientRole(me?.role) === 'admin' || adminBootstrapEmails().includes(String(me?.email ?? '').toLowerCase());
  } catch { return false; }
};
const SAFE_MEMBER_SELECT = 'username name surname profileImage';
const attachOwners = async (rows) => {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  if (list.length === 0) return rows;
  const ids = [...new Set(list.map((t) => String(t.partnerId ?? '')).filter(Boolean))];
  if (ids.length === 0) return rows;
  const owners = await PartnersModel.find({ _id: { $in: ids } })
    .select('username name surname')
    .lean()
    .catch(() => []);
  const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
    username: o.username,
    name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
  }]));
  for (const t of list) t.owner = labels[String(t.partnerId)] ?? null;
  return rows;
};


// Save team details  
export const saveTeam = async (req, res) => {
    const { teamName, description, teamPurpose } = req.body;
    const partnerId = sessionId(req); // creator is always the session owner  

    // Validate required fields  
    if (!teamName || !teamPurpose || !partnerId) {  
        return res.status(400).json({ 
            message: "Please fill in all required fields.",
            success: false
        });  
    }  

    // Create the team entry  
    const newTeam = new TeamModel({  
        teamName,  
        description,  
        teamPurpose,  
        partnerId  
    });  

    try {  
        const savedTeam = await newTeam.save();  
        res.status(200).json({
            savedTeam,
            message: "Team created successfully!",
            success: true
        });
    } catch (error) {  
        res.status(500).json({ 
            message: "Internal server error",
            error: error.message,
            success: false
        });  
    }  
};


// get team created by partner
export const getTeamsCreatedBy = async (req, res) => {
    try {
        const { partnerId } = req.params;
        if (String(partnerId) !== sessionId(req)) {
          return deny(res, 403, 'You can only view your own teams');
        }

        //console.log(partnerId)
      
        // Find teams objects for the partner  
        const teamsObject = await TeamModel.find({  
            partnerId: partnerId 
        });  

  
        if (!teamsObject || teamsObject.length === 0) {  
            return res.status(400).json({ 
                message: 'Teams not found',
                success: false
            });  
        } 

        res.status(200).json({  
            message: 'Teams retrieved successfully!',  
            data: teamsObject,
            success: true
        });

    } catch (error) {  
        res.status(500).json({  
            message: 'Error retrieving SMS and transactions',  
            error: error.message,
            success: false
        });  
    }  
}


/* // Get all teams where the partner is a member
const getTeamsByMember = async (req, res) => {
    try {
        const { partnerId } = req.params;

        const memberTeams = await TeamModel.find({ members: partnerId }).populate('members', SAFE_MEMBER_SELECT); // Find where partnerId is in members

        res.status(200).json({
            message: 'Teams where partner is a member retrieved successfully!',
            data: memberTeams,
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: 'Error retrieving teams',
            error: error.message,
        });
    }
}; */

// Get all teams where the partner is either the creator or a member
export const getTeamsByCreatorOrPartner = async (req, res) => {
  try {
    const { partnerId } = req.params;
    if (String(partnerId) !== sessionId(req)) {
      return deny(res, 403, 'You can only view your own teams');
    }

    // Single $or query — Mongoose casts both legs, so string/ObjectId
    // shape differences can't silently drop the member half. Dedupe
    // by id in case a creator is also listed as a member.
    const rows = await TeamModel.find({
      $or: [{ partnerId }, { members: partnerId }],
    }).populate('members', SAFE_MEMBER_SELECT);
    const plain = rows.map((r) => r.toObject());
    const seen = new Set();
    const uniqueTeams = plain.filter((team) => {
      const key = String(team._id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await attachOwners(uniqueTeams);

    res.status(200).json({
      message: 'Teams retrieved successfully!',
      data: uniqueTeams,
      success: true
    });

  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving teams',
      error: error.message,
    });
  }
};


// get a team by partner
export const getTeamBy = async (req, res) => {
    try {  
        const { id } = req.params;    
        // Find teams objects for the partner  
        const team = await TeamModel.findById(id).populate('members', SAFE_MEMBER_SELECT); // Populate members;  

        if (!team) {  
            return res.status(404).json({ 
                message: 'Team not found',
                success: false
            });  
        }

        const plain = team.toObject();
        await attachOwners(plain);

        res.status(200).json({  
            message: 'Team retrieved successfully!',
            data: plain,
            success: true
        });

    } catch (error) {  
        res.status(500).json({  
            message: 'Error retrieving SMS and transactions',  
            error: error.message,
            success: false
        });  
    }  
}

// delete a team by partner — owner only (requesterId required).
export const deleteTeamBy = async (req, res) => {
    try {  
        const { id } = req.params;
        const requesterId = sessionId(req); // session-owned (query/body values ignored)

        if (!requesterId) {
            return res.status(400).json({
                message: 'requesterId is required',
                success: false
            });
        }

        const team = await TeamModel.findById(id);
        if (!team) {
            return res.status(404).json({
                message: 'Team not found',
                success: false
            });
        }
        if (String(team.partnerId) !== String(requesterId)) {
            return res.status(403).json({
                message: 'Only the team owner can delete this team',
                success: false
            });
        }

        await TeamModel.findByIdAndDelete(id);

        res.status(200).json({  
            message: 'Team deleted successfully!',
            success: true
        });  

    } catch (error) {  
        res.status(500).json({  
            message: 'Error retrieving SMS and transactions',
            error: error.message, 
            success: false
        });  
    } 
}


// delete a team member — owner may remove anyone; a member may remove self (leave).
export const deleteTeamMember = async (req, res) => {
    try {
        const { teamId, memberId } = req.params; // Get both teamId and memberId
        const requesterId = sessionId(req); // session-owned (query/body values ignored)

        if (!requesterId) {
            return res.status(400).json({
                message: 'requesterId is required.',
                success: false
            });
        }

        // Owner may remove anyone; a member may remove only themselves (leave).
        const team = await TeamModel.findById(teamId).select('partnerId');
        if (!team) {
            return res.status(404).json({
                message: 'Team not found',
                success: false
            });
        }
        const isOwner = String(team.partnerId) === String(requesterId);
        const isSelf = String(memberId) === String(requesterId);
        if (!isOwner && !isSelf) {
            return res.status(403).json({
                message: 'Only the team owner can remove other members.',
                success: false
            });
        }

        // Find the team and update its members (using $pull)
        const updatedTeam = await TeamModel.findByIdAndUpdate(
            teamId,
            { $pull: { members: memberId } }, // $pull removes the specified memberId
            { new: true } // Return the updated document
        ).populate('members', SAFE_MEMBER_SELECT); // Populate members after deletion

        if (!updatedTeam) {
            return res.status(404).json({ 
                message: 'Team not found',
                success: false
            });
        }

        if (updatedTeam.members.length === 0) {
            return res.status(200).json({ 
                message: 'Team member deleted successfully! Team is now empty.', 
                success: true
            });
        }

        res.status(200).json({
            message: 'Team member deleted successfully!',
            success: true
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error deleting team member',
            error: error.message,
            success: false
        });
    }
};


// update a team by partner
export const updateTeamBy = async (req, res) => {
    try {  

       // console.log(req.body)
        const { temaId, teamPurpose, description, teamName} = req.body;
        const partnerId = sessionId(req); // session-owned (body value ignored)  

        // Owner-only: partnerId carries the editor's id — refuse anyone else.
        const existing = await TeamModel.findById(temaId).select('partnerId teamName description');
        if (!existing) {
            return res.status(404).json({
                message: 'Team not found',
                success: false
            });
        }
        if (!partnerId || String(existing.partnerId) !== String(partnerId)) {
            return res.status(403).json({
                message: 'Only the team owner can edit this team',
                success: false
            });
        }

        // Create an object with only the fields you want to update  
        const updateData = { teamName, description, teamPurpose };  

        const team = await TeamModel.findByIdAndUpdate(temaId, updateData, { new: true });  
        if (!team) {  
            return res.status(404).json({  
                message: `Team not found`,
                success: false
            });  
        }

        // Keep the linked group chat labelled like the team — only fields the
        // group admin never customized (still equal to the old team values).
        // Best-effort: team edits must never fail because of chat sync.
        try {
            const store = new MongoGroupStore();
            await store.syncTeamProfile(team._id,
                { name: team.teamName, description: team.description },
                { oldName: existing.teamName, oldDescription: existing.description });
        } catch { /* chat sync is best-effort */ }

        res.status(200).json({  
            message: 'Partner updated successfully!',  
            data: team,
            success: true
        });  

    } catch (error) {  
        res.status(500).json({  
            error: error.message,
            message: 'Error updating team',
            success: false
        });  
    } 
}


// add team member — owner only (requesterId required).
export const addTeamMember = async (req, res) => {
    const { teamMemberObject, teamId } = req.body;
    const requesterId = sessionId(req); // session-owned (body value ignored)
  
    //console.log(teamMemberObject);
    //console.log(teamId);
  
    // Validate required fields
    if (!teamMemberObject || !teamId) {
      return res.status(400).json({ 
        message: "Please fill in all required fields - team and partners are required.",
        success: false
    });
    }
  
    if (!Array.isArray(teamMemberObject) || teamMemberObject.length === 0) {
      return res.status(400).json({ 
        message: "Please provide at least one partner.",
        success: false
    });
    }
  
    try {
      // 1. Find the team
      const team = await TeamModel.findById(teamId);
  
      if (!team) {
        return res.status(404).json({ 
            message: "Team not found.",
            success: false
        });
      }

      if (!requesterId) {
        return res.status(400).json({
            message: "requesterId is required.",
            success: false
        });
      }
      if (String(team.partnerId) !== String(requesterId)) {
        return res.status(403).json({
            message: "Only the team owner can add members.",
            success: false
        });
      }
  
      // 2. Extract partner IDs (handling _id or id) and filter out duplicates
      // (string-compared — raw ObjectId inclusion checks miss string ids).
      const known = new Set((team.members ?? []).map((m) => String(m)));
      const partnerIds = [...new Set(
        (teamMemberObject ?? [])
          .map((partner) => partner?._id ?? partner?.id)
          .filter(Boolean)
          .map(String)
          .filter((id) => !known.has(id)),
      )];
  
      if (partnerIds.length === 0) {
          return res.status(200).json({ 
            message: "No new members to add",
            success: true
        });
      }
  
  
      // 3. Update the team's members (using $push and $each for efficiency)
      const updatedTeam = await TeamModel.findByIdAndUpdate(
        teamId,
        { $push: { members: { $each: partnerIds } } },
        { new: true } // Return the updated document
      );
  
      if (!updatedTeam) {
          return res.status(404).json({ 
            message: "Team not found.",
            success: false
        });
      }
  
      res.status(200).json({
        updatedTeam,
        message: "Team members added successfully!",
        success: true
    }); // Respond with the updated team
  
    } catch (error) {
      res.status(500).json({ 
        message: "Internal server error",
        error: error.message,
        success: false
    });
    }
};