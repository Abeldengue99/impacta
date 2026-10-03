import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

/** Read-only public community routes. Every card is backed by a persisted row. */
export function registerCommunityRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/feed/posts', async () => {
        const result = await pool.query(
            `SELECT post.id::text AS id,
                    post.body,
                    post.created_at,
                    COALESCE(author.display_name, 'Conta encerrada') AS author,
                    community.name AS community,
                    (SELECT count(reaction.user_id)::int FROM impacta.reactions AS reaction
                     WHERE reaction.post_id = post.id) AS support_count,
                    (SELECT count(comment.id)::int FROM impacta.comments AS comment
                     WHERE comment.post_id = post.id AND comment.status = 'published'
                       AND comment.deleted_at IS NULL) AS comment_count
             FROM impacta.posts AS post
             LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
             LEFT JOIN impacta.communities AS community ON community.id = post.community_id
             WHERE post.status = 'published' AND post.deleted_at IS NULL
               AND (post.author_user_id IS NULL OR author.status = 'active')
               AND (post.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY post.created_at DESC, post.id DESC
             LIMIT 50`
        );
        return { items: result.rows };
    });

    server.get('/api/v1/challenges', async () => {
        const result = await pool.query(
            `SELECT challenge.id::text AS id,
                    challenge.title,
                    challenge.description,
                    challenge.opens_at,
                    challenge.closes_at,
                    area.name AS impact_area,
                    (SELECT count(participation.id)::int FROM impacta.challenge_participations AS participation
                     WHERE participation.challenge_id = challenge.id
                       AND participation.status IN ('submitted', 'approved')) AS participant_count
             FROM impacta.challenges AS challenge
             LEFT JOIN impacta.projects AS project ON project.id = challenge.project_id
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE challenge.status = 'open'
               AND (challenge.project_id IS NULL OR project.status = 'active')
               AND (challenge.opens_at IS NULL OR challenge.opens_at <= now())
               AND (challenge.closes_at IS NULL OR challenge.closes_at > now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY challenge.opens_at NULLS FIRST, challenge.id DESC
             LIMIT 30`
        );
        return { items: result.rows };
    });

    server.get('/api/v1/projects', async () => {
        const result = await pool.query(
            `SELECT project.id::text AS id,
                    project.title,
                    project.description,
                    area.name AS impact_area,
                    community.name AS community,
                    (SELECT count(member.project_id)::int FROM impacta.project_members AS member
                     WHERE member.project_id = project.id) AS participant_count
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE project.status = 'active'
               AND (project.starts_at IS NULL OR project.starts_at <= now())
               AND (project.ends_at IS NULL OR project.ends_at >= now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY project.created_at DESC, project.id DESC
             LIMIT 30`
        );
        return { items: result.rows };
    });
}
