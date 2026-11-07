import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { 
    saveTeam, getTeamsCreatedBy, getTeamBy, updateTeamBy, deleteTeamBy, addTeamMember, deleteTeamMember, getTeamsByCreatorOrPartner
} from '../controllers/team.controller.js'
const TeamsRouter = express.Router();

const TeamCreate = z.object({
  teamName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(''),
  teamPurpose: z.string().trim().min(2).max(200),
});
const TeamUpdate = z.object({
  temaId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid team id'),
  teamName: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  teamPurpose: z.string().trim().min(2).max(200).optional(),
});

// All team writes are session-owned (creator/member checks inside use the
// session, never client-supplied ids). Reads are creator/member/admin scoped.
// create
TeamsRouter.post('/create', requireAuth, validateBodyInPlace(TeamCreate), saveTeam);
// get teams created by partner
TeamsRouter.get('/all-createdBy/:partnerId', requireAuth, getTeamsCreatedBy);
// get teams created by partner or a member of the team
TeamsRouter.get('/all-createdByOrMember/:partnerId', requireAuth, getTeamsByCreatorOrPartner);
// get team
TeamsRouter.get('/:id', requireAuth, getTeamBy);
// delete team
TeamsRouter.delete('/:id', requireAuth, deleteTeamBy);
// update team
TeamsRouter.put('/', requireAuth, validateBodyInPlace(TeamUpdate), updateTeamBy);
// add member
TeamsRouter.post('/add-member', requireAuth, addTeamMember);
// delete team member
TeamsRouter.delete('/remove-member/:teamId/:memberId', requireAuth, deleteTeamMember);


export default TeamsRouter;
