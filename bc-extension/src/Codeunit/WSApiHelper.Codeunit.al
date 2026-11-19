/// <summary>
/// Shared helpers for the Werkstatt API pages (line numbers, comment texts).
/// </summary>
codeunit 50102 "WS Api Helper"
{
    Access = Internal;

    procedure NextServiceLineNo(DocumentNo: Code[20]): Integer
    var
        ServiceLine: Record "Service Line";
    begin
        ServiceLine.SetRange("Document Type", ServiceLine."Document Type"::Order);
        ServiceLine.SetRange("Document No.", DocumentNo);
        if ServiceLine.FindLast() then
            exit(ServiceLine."Line No." + 10000);
        exit(10000);
    end;

    procedure NextServiceCommentLineNo(var ServiceCommentLine: Record "Service Comment Line"): Integer
    var
        Existing: Record "Service Comment Line";
    begin
        Existing.SetRange("Table Name", ServiceCommentLine."Table Name");
        Existing.SetRange("Table Subtype", ServiceCommentLine."Table Subtype");
        Existing.SetRange("No.", ServiceCommentLine."No.");
        Existing.SetRange(Type, ServiceCommentLine.Type);
        Existing.SetRange("Table Line No.", ServiceCommentLine."Table Line No.");
        if Existing.FindLast() then
            exit(Existing."Line No." + 10000);
        exit(10000);
    end;

    procedure NextResJournalLineNo(TemplateName: Code[10]; BatchName: Code[10]): Integer
    var
        ResJournalLine: Record "Res. Journal Line";
    begin
        ResJournalLine.SetRange("Journal Template Name", TemplateName);
        ResJournalLine.SetRange("Journal Batch Name", BatchName);
        if ResJournalLine.FindLast() then
            exit(ResJournalLine."Line No." + 10000);
        exit(10000);
    end;

    procedure NextItemJournalLineNo(TemplateName: Code[10]; BatchName: Code[10]): Integer
    var
        ItemJournalLine: Record "Item Journal Line";
    begin
        ItemJournalLine.SetRange("Journal Template Name", TemplateName);
        ItemJournalLine.SetRange("Journal Batch Name", BatchName);
        if ItemJournalLine.FindLast() then
            exit(ItemJournalLine."Line No." + 10000);
        exit(10000);
    end;

    procedure NextAllocationEntryNo(): Integer
    var
        ServiceOrderAllocation: Record "Service Order Allocation";
    begin
        if ServiceOrderAllocation.FindLast() then
            exit(ServiceOrderAllocation."Entry No." + 1);
        exit(1);
    end;

    procedure NextEmployeeAbsenceEntryNo(): Integer
    var
        EmployeeAbsence: Record "Employee Absence";
    begin
        if EmployeeAbsence.FindLast() then
            exit(EmployeeAbsence."Entry No." + 1);
        exit(1);
    end;

    /// <summary>
    /// Concatenates service comment lines of one type for an order (header: TableLineNo = 0).
    /// </summary>
    procedure GetServiceOrderComments(DocumentNo: Code[20]; TableLineNo: Integer; CommentType: Integer): Text
    var
        ServiceCommentLine: Record "Service Comment Line";
        Result: TextBuilder;
    begin
        ServiceCommentLine.SetRange("Table Name", ServiceCommentLine."Table Name"::"Service Header");
        ServiceCommentLine.SetRange("Table Subtype", ServiceCommentLine."Table Subtype"::"1"); // 1 = Order
        ServiceCommentLine.SetRange("No.", DocumentNo);
        ServiceCommentLine.SetRange("Table Line No.", TableLineNo);
        ServiceCommentLine.SetRange(Type, CommentType);
        if ServiceCommentLine.FindSet() then
            repeat
                if Result.Length() > 0 then
                    Result.Append(' ');
                Result.Append(ServiceCommentLine.Comment);
            until ServiceCommentLine.Next() = 0;
        exit(Result.ToText());
    end;

    procedure RequireMonteurAppId(MonteurAppId: Guid)
    var
        MissingIdErr: Label 'Das Feld monteurAppId ist ein Pflichtfeld (Idempotenzschlüssel).';
    begin
        if IsNullGuid(MonteurAppId) then
            Error(MissingIdErr);
    end;
}
