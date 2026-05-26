"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Modal, Val } from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { useAddChecklistComment } from "@/hooks";
import { Checklist } from "@/types";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { usePaymentsVisible } from "@/hooks";

export function ValidatorChecklists() {
  const [completedChecklists, setCompletedChecklists] = useState<Checklist[]>([]);
  const [confirmedChecklists, setConfirmedChecklists] = useState<Checklist[]>([]);
  const [selectedChecklist, setSelectedChecklist] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"completed" | "confirmed">("completed");
  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentChecklistId, setCommentChecklistId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  const { mutate: addComment, loading: addingComment } = useAddChecklistComment();
  const { paymentsVisible } = usePaymentsVisible();
  const toast = useToastActions();

  useEffect(() => {
    fetchChecklists();
  }, []);

  const fetchChecklists = async () => {
    try {
      const response = await fetch("/backend/checklists/fetch_validator_checklists");
      if (response.ok) {
        const data = await response.json();
        setCompletedChecklists(data.ready_for_confirmation || []);
        setConfirmedChecklists(data.confirmed_and_completed || []);
      }
    } catch (error) {
      console.error("Failed to fetch checklists:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectChecklist = (checklistId: number) => {
    setSelectedChecklist(selectedChecklist === checklistId ? null : checklistId);
  };

  const handleConfirmItem = async (checklistId: number, itemNumber: number, userId: number) => {
    try {
      await fetch("/backend/checklists/confirm_item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checklist_id: checklistId,
          item_number: itemNumber,
          user_id: userId,
        }),
      });
      fetchChecklists();
    } catch (error) {
      console.error("Failed to confirm item:", error);
    }
  };

  const openCommentModal = (checklistId: number) => {
    setCommentChecklistId(checklistId);
    setCommentText("");
    setShowCommentModal(true);
  };

  const handleAddComment = async () => {
    if (!commentChecklistId || !commentText.trim()) return;

    try {
      await addComment({
        checklist_id: commentChecklistId,
        comment: commentText.trim(),
      });
      toast.success("Comment added successfully");
      setShowCommentModal(false);
      setCommentChecklistId(null);
      setCommentText("");
      fetchChecklists();
    } catch {
      toast.error("Failed to add comment");
    }
  };

  const currentChecklists = activeTab === "completed" ? completedChecklists : confirmedChecklists;
  const totalPages = Math.ceil(currentChecklists.length / ROWS_PER_PAGE);
  const paginatedChecklists = currentChecklists.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const showingStart = currentChecklists.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, currentChecklists.length);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Checklists to Validate</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => {
            setActiveTab("completed");
            setSelectedChecklist(null);
            setCurrentPage(1);
          }}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "completed"
              ? "text-kaart-orange border-b-2 border-kaart-orange"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Ready for Confirmation ({formatNumber(completedChecklists.length).text})
        </button>
        <button
          onClick={() => {
            setActiveTab("confirmed");
            setSelectedChecklist(null);
            setCurrentPage(1);
          }}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "confirmed"
              ? "text-kaart-orange border-b-2 border-kaart-orange"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Completed & Confirmed ({formatNumber(confirmedChecklists.length).text})
        </button>
      </div>

      {/* Checklists */}
      <div className="space-y-4">
        {paginatedChecklists.map((checklist) => (
          <Card
            key={checklist.id}
            className={`transition-all ${
              selectedChecklist === checklist.id ? "ring-2 ring-kaart-orange" : ""
            }`}
          >
            <CardHeader
              className="cursor-pointer"
              onClick={() => handleSelectChecklist(checklist.id)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{checklist.name}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Assigned to: <Val fallback="Unknown">{checklist.assigned_user}</Val>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      checklist.difficulty === "Easy"
                        ? "bg-green-100 text-green-800"
                        : checklist.difficulty === "Medium"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {checklist.difficulty}
                  </span>
                  {paymentsVisible && (
                    <span className="text-sm text-muted-foreground">
                      <Val>{formatCurrency(checklist.validation_rate)}</Val>
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {checklist.list_items?.map((item, index) => (
                  <div
                    key={item.id ?? index}
                    className="flex items-center gap-3 p-2 rounded bg-muted/50"
                  >
                    {activeTab === "completed" && (
                      <input
                        type="checkbox"
                        checked={item.confirmed}
                        onChange={() =>
                          handleConfirmItem(checklist.id, item.number, checklist.assigned_user_id!)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-kaart-orange focus:ring-kaart-orange"
                      />
                    )}
                    {activeTab === "confirmed" && (
                      <span className="h-4 w-4 flex items-center justify-center text-green-600">
                        ✓
                      </span>
                    )}
                    <span className="flex-1">{item.action}</span>
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaart-orange hover:underline text-sm"
                      >
                        View
                      </a>
                    )}
                  </div>
                ))}
                {(!checklist.list_items || checklist.list_items.length === 0) && (
                  <p className="text-sm text-muted-foreground">No items in this checklist</p>
                )}
              </div>

              {/* Comments section */}
              {checklist.comments && checklist.comments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <h4 className="text-sm font-medium mb-2">Comments</h4>
                  <div className="space-y-2">
                    {checklist.comments.map((comment) => (
                      <div key={comment.id} className="text-sm p-2 bg-muted rounded">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{comment.author}</span>
                          <span>{comment.date}</span>
                        </div>
                        <p>{comment.comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "completed" && (
                <div className="mt-4 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCommentModal(checklist.id)}
                  >
                    Add Comment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {currentChecklists.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No {activeTab === "completed" ? "checklists ready for confirmation" : "confirmed checklists"}
          </div>
        )}
        {currentChecklists.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>Showing {showingStart}-{showingEnd} of {currentChecklists.length}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
              <span className="flex items-center px-2">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Add Comment Modal */}
      <Modal
        isOpen={showCommentModal}
        onClose={() => {
          setShowCommentModal(false);
          setCommentChecklistId(null);
          setCommentText("");
        }}
        title="Add Comment"
        description="Add a comment to this checklist"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setShowCommentModal(false);
                setCommentChecklistId(null);
                setCommentText("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddComment}
              isLoading={addingComment}
              disabled={!commentText.trim()}
            >
              Add Comment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Comment</label>
            <textarea
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              rows={4}
              placeholder="Enter your comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
