BEGIN;
CREATE TRIGGER task_review_immutable BEFORE UPDATE ON task_reviews FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
CREATE TRIGGER approval_immutable BEFORE UPDATE ON plan_approvals FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
CREATE TRIGGER role_map_review_immutable BEFORE UPDATE ON role_map_reviews FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
INSERT INTO schema_migrations(version) VALUES('006-review-integrity');
COMMIT;
